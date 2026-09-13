# Code Review — CV / Detection Layer

Date: 2026-09-13 | Reviewer: code-reviewer (read-only) | Branch: main
Scope: `src/lib/detection-pipeline.js`, `marker-detection.js`, `corner-marker-fallback.js`,
`image-preprocessing.js`, `image-quality-check.js`, `answer-detection.js`,
`bubble-grid-generator.js`, `debug-visualization.js`, `types.js`;
`src/components/ImageProcessor.jsx` as integration context.
Out of scope: scoring/statistics/IndexedDB internals (read only to substantiate impact).
LOC in scope: ~1,350. Tests: none exist. `npx eslint src/lib src/components/ImageProcessor.jsx` → 0 errors, 1 warning (`no-img-element`).

## Overall Assessment

Structurally clean, **not production-trustworthy for grading**. Three independent mechanisms each
turn a bad photo into a *plausible, fully-populated, silently wrong* result rather than a detectable
failure: (a) `measureBubbleFill` runs per-ROI Otsu on ROIs smaller than the printed bubble, so an
empty bubble measures ~50% filled; (b) digit strings (`studentId`, `examCode`, Phần III) are built by
concatenation with missed positions *skipped*, so one miss shifts every later digit; (c) Phần II
unanswered defaults to `false`, which `scorePhanII` cannot distinguish from an answered "Sai" and
therefore awards points for. Quality checks are computed but purely advisory — the pipeline runs to
completion and stores `processed: true` with a hardcoded `confidence: 0.85`.

Separately: 9 OpenCV Mat leak sites, one of which (`MatVector.get(i)`) leaks on the **success** path
once per contour per image. The batch-crash risk in the brief is real.

Verified non-issues (do not "fix"):
- `cv.Size` / `cv.Rect` / `cv.Point` are embind **value objects** (plain JS objects) — no `.delete()`.
  `marker-detection.js:152`, `image-preprocessing.js:39,54,105` are **not** leaks.
- `applyPerspectiveCorrection` returning `src` aliased as `corrected` is safe: caller guards with
  `if (perspectiveApplied)` (`detection-pipeline.js:69`). No double-free.

---

## CRITICAL

### C1. Empty bubbles measure ~50% filled → fabricated answers on blank/misaligned sheets
`src/lib/image-preprocessing.js:110` (Otsu), `src/lib/bubble-grid-generator.js:74` (ROI size)

`measureBubbleFill` runs `THRESH_OTSU` per bubble ROI. Otsu assumes a bimodal histogram; on a uniform
ROI it degenerates and splits sensor noise roughly in half. ROI size is `BUBBLE_SIZE_RATIO = 0.012` of
sheet width — ~24px on a 2000px sheet, while a CV1239 bubble is ~4mm ≈ 38px at that scale. The ROI
therefore sits *inside* the printed ring: for an unmarked bubble it contains only blank paper → no ink
pixels → degenerate Otsu → reported fill ≈ 0.3–0.5.

Failure chain: unmarked bubbles report ~0.45 → `computeAdaptiveThreshold` (`image-preprocessing.js:75`)
keeps only `f < 0.3` as "empty", finds fewer than 20 → returns the 0.35 fallback → `findBestFilled`
(`answer-detection.js:223`) picks whichever noise reading is highest → **every question gets an
answer**. Input: any blank sheet, any misaligned grid, any low-contrast scan. Output: a complete,
confident, wrong answer set, no error raised.

Minimal fix: gate on absolute contrast before trusting Otsu. In `measureBubbleFill`, compute
`cv.minMaxLoc(roi)` and `return 0` when `max - min < ~40` (no ink present); and size the ROI to cover
the ring (`BUBBLE_SIZE_RATIO` ~0.018–0.02) so an empty bubble is genuinely bimodal. Same change also
repairs the `computeAdaptiveThreshold` baseline.

### C2. Missing digit collapses the string — wrong student ID, wrong exam code
`src/lib/answer-detection.js:23-29` (studentId), `:48-54` (examCode), `:152-158` (Phần III)

```js
const best = findBestFilled(colBubbles, gray, threshold);
if (best && best.row !== undefined) { studentId += best.row.toString(); }
```
If column 3 of 8 is undetected the loop skips it: `"12345678"` → `"1234567"`. A valid-looking 7-digit
ID silently misattributes the grade. Same shape for the 4-digit exam code — and the exam code selects
the answer key, so one dropped digit grades the whole sheet against the wrong key. Phần III is
identical: a missed `,` turns `-1,5` into `-15`, which `scorePhanIII` (`src/lib/scoring.js:111`) marks
wrong with no signal that detection, not the student, failed.

Minimal fix: append a sentinel instead of skipping, and treat it as "needs review" upstream:
```js
studentId += best?.row !== undefined ? best.row.toString() : '?';
```
Same for `examCode` and each Phần III char position. (`detectPhanIIIAnswers:160`'s `trimEnd()` is dead
today — nothing ever appends a space — and would need to become a rule about trailing sentinels.)

### C3. Unanswered Phần II sub-item is scored as an answered "Sai"
`src/lib/answer-detection.js:107,117-119` + `src/lib/scoring.js:82-84`

```js
const answer = { a: false, b: false, c: false, d: false };
...
if (trueConf > threshold || falseConf > threshold) { answer[subOpt] = trueConf > falseConf; }
```
When neither bubble clears threshold the field stays `false`. `scorePhanII` compares
`student[sub] === correct[sub]`, so a blank sub-item matches every key entry whose correct value is
"Sai" and earns `pointsPerQuestion`. A blank Phần II scores ~50% of Phần II on average; a sheet where
detection failed entirely reads as a partially-correct paper. There is no tri-state.

Minimal fix: make "unanswered" representable — `{ a: null, b: null, c: null, d: null }`, assign
`true`/`false` only when a bubble clears threshold, and add `if (student[sub] === null) continue;` to
`scorePhanII`. (Type change at `types.js:48-53`, `TrueFalseAnswer` → `boolean|null`; this alters the
shape of data already in IndexedDB — see unresolved question 4.)

### C4. `MatVector.get(i)` result never deleted — one Mat leaked per contour, per image
`src/lib/marker-detection.js:31`, `src/lib/corner-marker-fallback.js:31`

`contours.get(i)` returns a **new** JS-owned `cv.Mat` (shallow copy, refcount++ on the point buffer).
`contours.delete()` at `marker-detection.js:67` frees the C++ vector but not the JS-side copies. A
noisy phone photo commonly yields 1,000–10,000 contours, and the fallback path iterates them again
with `RETR_LIST`. Across a 40-sheet batch the wasm heap grows monotonically until
`Cannot enlarge memory arrays` / tab crash. This is on the **success** path, not an error path.

Minimal fix: delete each retrieved contour before the next iteration, on every branch:
```js
for (let i = 0; i < contours.size(); i++) {
  const contour = contours.get(i);
  try { /* existing body */ } finally { contour.delete(); }
}
```

### C5. No `try/finally` anywhere — every exception path leaks the whole Mat set
`src/lib/detection-pipeline.js:26-69`

`src`, `gray`, `thresh`, `corrected` are deleted only at lines 66-69, reached only on the happy path.
Anything throwing in between (`cv.warpPerspective` on degenerate corners, OOM in
`createDebugVisualization`'s `toDataURL`, any cv exception) leaks all four full-image Mats — ~5MB
grayscale + ~20MB RGBA per failed 2000×2500 image. `ImageProcessor.jsx:64-66` catches and continues to
the next file, so failures accumulate within one batch.

Minimal fix: declare the handles before a `try`, wrap lines 27-64, and delete in `finally`. Same
pattern needed in `preprocessForBubbleDetection`, `measureBubbleFill`, `checkImageQuality`,
`applyPerspectiveCorrection` (see leak table).

### C6. Upside-down / heavily-rotated sheet is graded silently
`src/lib/marker-detection.js:78-94` (`orderCornerPoints`), `:45` (aspect filter)

`orderCornerPoints` labels corners by sorting on `y` then `x` — valid only below ~45° rotation.
Worked example, portrait sheet (w:h = 0.7:1) rotated 60°: sorted-by-y order is `[TR, BR, TL, BL]`, so
the function assigns `topLeft = TR`, `topRight = BR`, `bottomLeft = TL`, `bottomRight = BL` — a cyclic
relabel. The bounding-rect aspect at that rotation is 1.216/1.106 ≈ 1.10, which **passes** the
`aspect > 0.4 && aspect < 1.2` filter at line 45. The warp then emits a 90°-rotated sheet and the
proportional grid reads Phần I where Phần III is.

A 180° flip is worse: labels are consistently swapped, aspect passes, warp succeeds, and every bubble
maps to its point-mirror. Nothing detects it — `checkImageQuality` reports 4 markers and
`passed: true`. Output is a full, plausible, entirely wrong answer set.

Minimal fix (two small parts):
1. Replace the y-sort with the rotation-stable sum/diff rule: `TL = argmin(x+y)`, `BR = argmax(x+y)`,
   `TR = argmin(y-x)`, `BL = argmax(y-x)`.
2. After computing `dstWidth`/`dstHeight` (`marker-detection.js:136-141`), reject non-portrait output
   (`dstHeight <= dstWidth` → `applied: false` + a quality issue) so a rotated capture fails loudly.
   180° detection needs a sheet-asymmetry anchor — see unresolved question 3.

### C7. `img.onerror` unhandled → batch loop hangs forever
`src/components/ImageProcessor.jsx:39-73` + `src/components/UploadPage.jsx:95-97`

`processImage` sets `img.onload` but never `img.onerror`. `UploadPage` drives the batch with
`await new Promise((resolve) => { resolveRef.current = resolve; })`, resolved only inside
`handleProcessingComplete`. A truncated/corrupt JPEG fires `onerror`, `onProcessingComplete` is never
called, the promise never settles: the UI sits on "Đang xử lý…" indefinitely with no cancel and no
timeout, and `URL.revokeObjectURL` never runs.

Minimal fix:
```js
img.onerror = () => {
  URL.revokeObjectURL(imageUrl); setProcessing(false);
  onProcessingComplete({ error: true, errorMessage: 'Không đọc được ảnh' });
};
```

### C8. Error results stored as normal results with `undefined` answer arrays
`src/components/ImageProcessor.jsx:66` → `src/components/UploadPage.jsx:50-65`

On a pipeline throw the component calls `onProcessingComplete({ error: true, errorMessage })`.
`handleProcessingComplete` ignores `result.error` and builds
`{ studentId: undefined, phanI: undefined, phanII: undefined, phanIII: undefined, processed: true }`,
pushes it to `resultsRef` and passes it to `onResultsAdd`. `scorePhanI` (`scoring.js:58`) then indexes
`undefined[i]` → TypeError during scoring, or the row renders as a student with no ID and a 0 score
indistinguishable from a blank paper.

Minimal fix: branch on `result.error` first in `handleProcessingComplete`; record
`{ processed: false, error: result.errorMessage }` and exclude it from `onResultsAdd`.

---

## HIGH

### H1. Corner-marker fallback is fed the wrong contour set — it can almost never succeed
`src/lib/marker-detection.js:64` vs `src/lib/corner-marker-fallback.js:23`

`detectSheetContour` computes contours with `RETR_EXTERNAL` (line 24) and passes that vector to the
fallback. The fallback, when building its own, deliberately uses `RETR_LIST` (line 23) because the
corner marker squares are *nested inside* the sheet border and are therefore excluded by
`RETR_EXTERNAL`. Consequence: `candidates` is almost always empty → `findFourCorners` returns `null`
(line 75) → the function silently returns the image-bounds-with-3%-margin box
(`corner-marker-fallback.js:56-64`). The bubble grid is then laid over the whole *photo*, desk
background included, and detection proceeds. This is the main producer of the C1 scenario.

Minimal fix: drop the reuse at `marker-detection.js:64` — call
`detectCornerMarkers(thresh, imageWidth, imageHeight)` — and remove the now-unused `existingContours`
parameter with its `if (!contours)` branch.

### H2. Detection failure is advisory only; no result is ever rejected
`src/lib/detection-pipeline.js:30,50-59`, `src/lib/image-quality-check.js:65-70`

`checkImageQuality` is computed and attached, but no branch acts on it. A sheet with
`markersFound: 0` (the H1 path) and `blur` flagged is still fully "detected", stored with
`processed: true` (`UploadPage.jsx:61`), and the UI shows an amber advisory next to a green "Đã xử lý"
badge (`UploadPage.jsx:212-220`). A teacher batch-processing 40 sheets will not reconcile 40 advisories.

Minimal fix: in `runDetectionPipeline`, when `qualityReport.passed === false && markersFound < 4`,
return `{ result: { error: true, errorMessage: <issues>, qualityReport }, debugUrl: null }` instead of
answers, and render those rows as "cần chụp lại". Losing a sheet to a re-scan is strictly cheaper than
an undetectably wrong grade.

### H3. `confidence: 0.85` is a hardcoded constant, and it is dead
`src/lib/detection-pipeline.js:58`

The only `confidence` the pipeline produces is a literal. `types.js:87` documents it as a real field;
`grep -rn "\.confidence\b" src/` finds no consumer. Anything reading it later (export, review queue,
sorting) reads a lie.

Minimal fix: delete the field, or derive it (e.g. min over questions of `bestFill - secondBestFill`,
normalized) before any consumer is written against it.

### H4. No margin/tie check in `findBestFilled` — double marks resolve on a noise-level delta
`src/lib/answer-detection.js:223-236`

Returns `argmax(fill)` with no requirement that the winner beat the runner-up. A student who fills A,
changes their mind and fills B without erasing yields `{ A: 0.91, B: 0.93 }` → answer `B`, unflagged.
Vietnamese THPT rules treat a double mark as invalid; here it is a coin flip. Same at
`detectPhanIIAnswers:118` (`trueConf > falseConf`): both bubbles filled silently resolves to the
darker one.

Minimal fix: track the top two fills and return `null` (caller-visible "ambiguous") when
`best - second < 0.15` instead of returning the marginal winner.

### H5. Debug overlay is drawn on the wrong canvas — the verification surface is misleading
`src/components/ImageProcessor.jsx:47,61` + `src/lib/detection-pipeline.js:62-64`

`imageData` comes from `processCanvas` (downscaled to ≤2000px by `resizeForProcessing`), but the
canvas passed to `runDetectionPipeline` for visualization is the **full-resolution** `canvas`. For any
phone photo (>2000px wide), bubble coordinates computed in downscaled space are drawn onto a 2–3×
larger image: every circle lands in the upper-left quadrant. Worse, when perspective correction is
applied the bubbles are in *warped* space while the canvas is unwarped, so the overlay is wrong even
for small images. The debug image is the operator's only sanity check and currently cannot be trusted
in either direction.

Minimal fix: pass `processCanvas` at `ImageProcessor.jsx:61`; when `perspectiveApplied`, render onto
the warped `activeGray` (via `cv.imshow` into a scratch canvas) instead of the original.

### H6. Grid coordinates are cell centers; every consumer treats them as top-left
`src/lib/bubble-grid-generator.js:98,131,277` vs `src/lib/image-preprocessing.js:105`, `src/lib/debug-visualization.js:68-69`

The generator explicitly centers within the cell (`+ colSpacing * 0.5`, `+ charColWidth * 0.5`) — i.e.
`(x, y)` is a bubble **center**. `measureBubbleFill` builds `new cv.Rect(x, y, w, h)`, treating
`(x, y)` as the ROI **top-left**, and `drawAllPositions` computes `cx = bubble.x + bubble.width / 2`,
same assumption. Net: every ROI is offset `+size/2` on both axes (~12px on a 2000px sheet against a
~24px ROI), biasing measurements toward the down-right neighbour / label text. Compounds C1 — a
shifted, undersized ROI is even likelier to contain only blank paper.

Minimal fix: subtract half the bubble size when pushing (one line per section):
`x: pos.x - size / 2, y: pos.y - size / 2`. Leave the consumers' top-left convention alone.

### H7. A photo on a dark background detects the whole frame as the sheet
`src/lib/marker-detection.js:24,35,41-48`

`preprocessForBubbleDetection` uses `THRESH_BINARY_INV`, so dark regions become foreground. A sheet
photographed on a dark desk yields one huge external contour covering the frame; `approxPolyDP`
reduces it to 4 corners; the bounding-rect aspect equals the *image* aspect (2000×2500 → 0.8), which
passes the 0.4–1.2 filter. The "sheet" is the entire photo, the warp is a near no-op, and the grid is
laid over desk + sheet. Silently wrong answers with `qualityReport.passed === true`.

Minimal fix: add `if (area > imageArea * 0.95) continue;` beside the existing `area < imageArea * 0.1`
guard at line 35.

---

## MEDIUM

### M1. `questionCount` up to 100 accepted, but the grid hardcodes 40 / 8 / 6
`src/components/ConfigurationPage.jsx:101` (`max="100"`), `src/lib/bubble-grid-generator.js:29,31,34`

`SHEET_LAYOUT` always generates 40 Phần I, 8 Phần II, 6 Phần III questions regardless of config.
`detectPhanIAnswers` loops to `questionCount` and pushes `''` for 41+; `detectPhanIIAnswers` pushes
all-`false` objects for 9+ (which C3 converts into free points). `calculateScore`'s `maxTotal`
(`scoring.js:34-37`) counts the phantom questions, so percentages silently deflate.
Minimal fix: clamp the config inputs to what the layout supports (`max="40"` / `"8"` / `"6"`), or
derive layout counts from config and fail fast when they exceed the printed sheet.

### M2. Every bubble ROI is measured 3–4 times
`src/lib/image-preprocessing.js:74`, `src/lib/answer-detection.js:81,84,229`, `src/lib/debug-visualization.js:89,122`

704 bubbles are generated per sheet (80 + 40 + 160 + 64 + 360). `computeAdaptiveThreshold` measures all
704; `detectPhanIAnswers` measures section1 twice (once for `confidenceMap`, once inside
`findBestFilled`); the debug pass measures again. Each call allocates an ROI Mat + a binary Mat and
runs Otsu → ~2,500 Otsu runs and ~5,000 Mat alloc/free cycles per image; dominant cost in a batch.
Minimal fix: measure once into a `Map<Bubble, number>` in `runDetectionPipeline` and pass the map down
instead of `gray` + re-measuring.

### M3. Phần III debug rendering is dead code against a removed field
`src/lib/debug-visualization.js:189`, `src/lib/types.js:42`

`if (bubble.digit?.toString() === detected)` — the multi-char generator
(`bubble-grid-generator.js:280-292`) emits `charPosition` + `charValue` and never `digit`, so the
condition is always false and Phần III is never annotated. `detected` is now a multi-character string
(`"-1,5"`), so comparing it to a single digit could never work anyway.
Minimal fix: match on `bubble.charValue === detected[bubble.charPosition]`, or delete the function and
the legacy `digit` field in `types.js` if Phần III debug output is not wanted.

### M4. Manual-correction "low confidence" thresholds unrelated to the detection threshold
`src/lib/detection-pipeline.js:57` (produces `fillThreshold`) → not copied at `UploadPage.jsx:50-62`
→ `src/components/manual-correction-modal.jsx:128`

The pipeline computes an adaptive `fillThreshold` (0.25–0.50) and returns it, but
`handleProcessingComplete` never copies it onto the stored result, so the correction UI hardcodes
`selectedFill > 0.25 && selectedFill < 0.45`. With an adaptive threshold of 0.50, an answer detected at
0.52 shows as high confidence; with 0.25, answers at 0.46+ show as confident although they barely
cleared a degenerate baseline. The highlight does not track the decision it claims to describe.
Minimal fix: persist `fillThreshold` on the result and flag when `selectedFill < fillThreshold * 1.3`.

### M5. Confidence is produced for Phần I only
`src/lib/answer-detection.js:88` vs `:125,163`

`detectPhanIIAnswers` and `detectPhanIIIAnswers` return bare answers; the fill values they compute
(lines 114-115, 154) are discarded. The correction UI therefore cannot highlight ambiguous true/false
or numeric answers at all — the two sections where C2/C3 do the most damage.
Minimal fix: return `{ answers, confidenceMap }` from both, mirroring `detectPhanIAnswers`.

### M6. Worker support is claimed, but two modules hard-require `window`
`src/lib/detection-pipeline.js:17,24` vs `src/lib/image-preprocessing.js:31`, `src/lib/image-quality-check.js:27`

`runDetectionPipeline` resolves `self.cv || window.cv` and documents "Works … in Web Worker", but
`preprocessForBubbleDetection` and `checkImageQuality` use bare `const cv = window.cv`. In a worker
both throw `ReferenceError: window is not defined` on first call. No worker exists yet (`grep` finds
only a comment at `UploadPage.jsx:192`), so this is an untested claim, not a live bug — but it will
bite whoever moves processing off the main thread.
Minimal fix: use `(typeof self !== 'undefined' && self.cv) || window.cv` in both, or hoist a shared
`getCv()` helper.

### M7. `applyPerspectiveCorrection` returns stale corners alongside warped bounds
`src/lib/marker-detection.js:158-162`

`updatedMarkers.corners` / `.edges` keep pre-warp image coordinates while `boundingBox` is in warped
space — two fields in different coordinate systems, silently. Only `boundingBox` is consumed today, so
this is latent; any future consumer of `corners` after correction gets wrong geometry.
Minimal fix: `corners: [{x:0,y:0},{x:dstWidth,y:0},{x:dstWidth,y:dstHeight},{x:0,y:dstHeight}]`.

### M8. Degenerate corners are not validated before the warp
`src/lib/marker-detection.js:136-152`

If `approxPolyDP` returns four near-collinear/near-coincident points, `dstWidth`/`dstHeight` can be 0 or
a few pixels and `getPerspectiveTransform` yields a singular matrix; `warpPerspective` either throws
(leaking `srcPts`/`dstPts`/`M`/`corrected` — leak L5) or produces garbage that is then graded.
Minimal fix: before allocating,
`if (dstWidth < imageWidth * 0.3 || dstHeight < imageHeight * 0.3) return { corrected: src, markers, applied: false };`

---

## LOW

### L-a. `buildMarkerResult` and `buildResult` are byte-identical duplicates
`src/lib/marker-detection.js:101-112` and `src/lib/corner-marker-fallback.js:111-121` — same body, same
JSDoc. Any change to the bounding-box convention must be made twice.
Fix: export one (from `marker-detection.js` or a shared module) and import it in the fallback.

### L-b. `Infinity` leaks into persisted metrics
`src/lib/image-quality-check.js:53,77`. The catch sets `variance = Infinity` to skip the blur check;
`Math.round(Infinity)` is `Infinity`, which `JSON.stringify` (session export,
`session-export-import.js`) turns into `null`. Fix: use a sentinel like `-1` and branch on it.

### L-c. `answer.trimEnd()` is dead
`src/lib/answer-detection.js:160`. Nothing ever appends whitespace — skipped positions are omitted
entirely (that is C2). Remove it, or give it meaning as part of the C2 fix.

### L-d. `markersFound` under-reports the fallback's partial results
`src/lib/image-quality-check.js:64` reads `markers.corners.length`, but the fallback returns
`corners: []` with candidates in `edges` (`corner-marker-fallback.js:58-59`). A sheet with 3 detected
markers reports "tìm thấy 0/4 góc" — cosmetic, but hides how close detection came.

### L-e. `opencv-ts` is a runtime dependency but never imported
`package.json:12`; `grep -rn "opencv-ts" src/` → no matches. The app loads OpenCV from the CDN
(`src/app/layout.jsx:26-29`). An unused 8.6MB dependency.

---

## OpenCV Mat Leak Sites (complete)

| # | File:line | Object(s) | Leaks on | Severity | Minimal fix |
|---|-----------|-----------|----------|----------|-------------|
| L1 | `marker-detection.js:31` | `contours.get(i)` Mat | **Success path**, every iteration | CRITICAL | `try/finally { contour.delete(); }` inside the loop |
| L2 | `corner-marker-fallback.js:31` | `contours.get(i)` Mat | **Success path**, every iteration (`RETR_LIST` → more contours) | CRITICAL | same |
| L3 | `detection-pipeline.js:26,27,69` | `src`, `gray`, `thresh`, `corrected` | Any throw in lines 27-64 | CRITICAL | wrap 27-64 in `try`, deletes in `finally` |
| L4 | `image-preprocessing.js:34,38,42,54,55` | `gray`, `blurred`, `thresh`, `kernel`, `closed` | Throw in `cvtColor`/`GaussianBlur`/`adaptiveThreshold`/`morphologyEx` | HIGH | declare above, delete intermediates in `finally` |
| L5 | `marker-detection.js:143,146,150,151` | `srcPts`, `dstPts`, `M`, `corrected` | Throw in `getPerspectiveTransform`/`warpPerspective` (degenerate corners — M8) | HIGH | `try/finally` for the transform Mats; delete `corrected` before rethrow |
| L6 | `image-preprocessing.js:106,109` | `roi`, `binary` | Any throw before lines 115-117 — swallowed by `catch {}` at :119 | HIGH | move both deletes into a `finally` |
| L7 | `image-quality-check.js:42,45,46` | `laplacian`, `meanMat`, `stdDevMat` | Throw in `Laplacian`/`meanStdDev` — swallowed by `catch {}` at :51 | MEDIUM | `finally { laplacian?.delete(); meanMat?.delete(); stdDevMat?.delete(); }` |
| L8 | `marker-detection.js:38` | `approx` | Throw in `approxPolyDP` (:39) or `boundingRect` (:42) | MEDIUM | `try/finally` around lines 39-53 |
| L9 | `marker-detection.js:20,21` | `contours`, `hierarchy` | Throw in `findContours` (:24), in the loop, or in `detectCornerMarkers` | MEDIUM | `try/finally` around lines 24-65 |

Amplification: L6 fires up to ~2,500× per image (M2), so one systematic ROI failure (e.g. an
out-of-bounds `cv.Rect` from a misplaced grid) leaks thousands of Mats on a *single* photo while
returning `0` — silently reporting every bubble empty at the same time.

Not leaks (verified): `cv.Size` at `marker-detection.js:152`, `image-preprocessing.js:39,54`;
`cv.Rect` at `image-preprocessing.js:105`. Embind value objects, no `delete` method.

---

## Edge Cases (scouted; not visible in a single-file read)

- **Blank sheet** → C1 + C3: fabricated Phần I/III answers plus ~50% of Phần II credit.
- **Sheet on dark background** → H7: whole frame treated as the sheet, grid over the desk.
- **Rotated >45° or 180°** → C6: cyclic/mirrored corner labels, aspect filter passes, graded.
- **No border found (crop, glare, dark edge)** → H1 → image-bounds fallback → grid over the photo.
- **Corrupt/undecodable image** → C7: batch loop hangs forever, no timeout, no cancel.
- **Pipeline throws mid-batch** → C8 (`undefined` answer arrays reach scoring) + L3 (~25MB of Mats
  leaked per failure); the two compose into a tab crash partway through a 40-sheet batch.
- **Phone photo > 2000px** → H5: overlay drawn at the wrong scale, so the only verification tool is
  useless exactly when downscaling error is largest.
- **Double-marked question** → H4: resolved by a noise-level delta instead of flagged invalid.
- **One dropped digit in SBD / mã đề** → C2: grade attributed to the wrong student, or scored against
  the wrong answer key.

## Recommended Actions (ordered)

1. C4 + C5 + L1-L9 — add `try/finally` Mat discipline and delete `contours.get(i)` results. Mechanical;
   unblocks batch use.
2. C1 + H6 — absolute-contrast gate in `measureBubbleFill`, larger `BUBBLE_SIZE_RATIO`, fix the
   center/top-left mismatch. Root cause of "plausible but wrong".
3. C3 + C2 — make "unanswered" and "undetected digit" representable (`null` / `'?'`) and teach
   `scoring.js` to skip them. Needs a decision on already-stored results.
4. C7 + C8 — `img.onerror` handler and an `error` branch in `handleProcessingComplete`.
5. H1 + H7 + H2 — stop reusing `RETR_EXTERNAL` contours in the fallback, reject whole-frame contours,
   and make a failed quality report abort the sheet instead of annotating it.
6. C6 — rotation-stable corner ordering + portrait check.
7. H5, H3, H4, M1-M8 as follow-up.
8. Before any of this lands: add at least one fixture-based check (a scan of
   `assets/cv1239-thpt-answer-sheet-template.png` with known marks). Every finding above is currently
   unfalsifiable in CI — there are no tests and `eslint` passes clean on all of it.

## Metrics

- Lint (scope): 0 errors, 1 warning (`@next/next/no-img-element`, `ImageProcessor.jsx:107`).
- Type checking: `jsconfig.json` sets `checkJs: true, strict: true`, but there is no `typescript`
  dependency and no `typecheck` script in `package.json` — **the setting is never enforced**.
  Effective type coverage of the CV layer: JSDoc-annotated but unverified.
- Test coverage: 0% (no test framework, no test files).
- Mat leak sites: 9 (2 on the success path).

## Unresolved Questions

1. **Are the `SHEET_LAYOUT` ratios real?** `bubble-grid-generator.js:21` claims they were "measured
   from official template PDF", but they are round numbers (0.03, 0.12, 0.30, 0.59, 0.72) and no
   measurement artifact is in the repo. Measured against
   `assets/Bộ GD 2025 - CV1239 _ đen trắng.pdf`, or estimated? Every geometry finding assumes they are
   approximately right.
2. **Real bubble diameter as a fraction of sheet width?** `BUBBLE_SIZE_RATIO = 0.012` is the input to
   C1 and H6; the value should come from the template, not a guess.
3. **Does the CV1239 sheet have asymmetric anchor markers?** Required to detect a 180° flip (C6);
   without one, the options are an OCR/text cue or an explicit operator confirmation step.
4. **C3 data migration**: changing `TrueFalseAnswer` to `boolean|null` alters records already in
   IndexedDB. Migrate, or version the record?
5. **H2 product decision**: reject a low-quality sheet outright (operator re-scans) or grade-with-
   warning? Current behaviour is the latter; the risk profile argues for the former.
6. Is `opencv-ts` intended to become the runtime source (replacing the CDN `<Script>`), or vestigial
   (L-e)? The CDN dependency at `layout.jsx:27` is also an availability/supply-chain coupling with no
   SRI hash and no offline fallback.
