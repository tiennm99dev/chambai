# CV Detection Pipeline Fixes — Implementation Report

Date: 2026-09-13 | Scope: src/lib/{detection-pipeline,marker-detection,corner-marker-fallback,
image-preprocessing,image-quality-check,answer-detection,bubble-grid-generator,debug-visualization}.js

## Measured template geometry (evidence for C1/H6)

Measured `assets/cv1239-thpt-answer-sheet-template.png` (1638x2339px, 200dpi) with a throwaway
`sharp`-based connected-component script (written to and deleted from the session scratchpad, not
committed). Findings:
- studentId grid (8 cols x 10 rows): ring outer diameter ~23.5px, row pitch ~29.8px.
- Phần I option grid: ring outer diameter ~24.5px, horizontal (A-B-C-D) pitch ~65.5px, vertical
  (question row) pitch ~39.5px.
- Diameter/sheet-width ratio: 0.0143-0.015 (mean ~0.0146). Old `BUBBLE_SIZE_RATIO = 0.012` was
  ~20% too small even for the exact ring diameter, let alone covering it with margin.
- Tightest neighbor constraint is the studentId row pitch: ratio 0.0182. New ratio must stay under
  this to avoid the ROI bleeding into the next digit row.
- New `BUBBLE_SIZE_RATIO = 0.016` — covers the full measured ring with margin, stays safely under
  the 0.0182 neighbor-pitch ceiling. (Report's guess of ~38px/0.019 from an assumed "4mm bubble"
  was wrong; measured actual is closer to 3mm/0.015.)

## Per-file changes

**bubble-grid-generator.js** — `BUBBLE_SIZE_RATIO` 0.012→0.016 (measured, see above). H6: all 5
`generate*Bubbles` functions now push `x: pos.x - size/2, y: pos.y - size/2` (center→top-left)
since every consumer (`measureBubbleFill`, debug overlay `cx = bubble.x + width/2`) treats
`bubble.x/y` as ROI top-left, not center. This alone was silently offsetting every ROI ~half a
bubble-width down-right.

**image-preprocessing.js** — C1: removed per-ROI `THRESH_OTSU` (degenerates on a blank/unimodal
ROI, reading ~0.3-0.5 fill on an empty bubble). Added `computeGlobalThreshold(gray)`: one Otsu run
over the whole page (genuinely bimodal — ink+markers vs. paper), returning a single intensity
threshold. `measureBubbleFill` now: (a) absolute-contrast gate via `cv.minMaxLoc` — ROI with
`max-min < 40` returns 0 immediately (no ink present); (b) fixed (non-Otsu) threshold against the
page-level value. `computeAdaptiveThreshold` now returns `{ threshold, reliable }` — `reliable:
false` (fallback 0.35) when `empties.length < 20` (misaligned/degenerate) or `empties.length ===
fills.length` (literally nothing registers as filled anywhere — can't tell blank sheet from failed
detection). Leaks: `preprocessForBubbleDetection` rewritten with try/finally (L4); `measureBubbleFill`
roi/binary released in finally (L6, was only deleted on the success path, swallowed by bare
`catch{}`).

**answer-detection.js** — C2: `detectStudentId`/`detectExamCode`/`detectPhanIIIAnswers` append
`UNKNOWN_DIGIT` (imported from `types.js`) instead of skipping an unread position, so string length
always equals field width. C3: Phần II sub-items default `null` (was `false`), tri-state per frozen
contract. H4: `findBestFilled` tracks top-two fills, returns `null` when `best - second <
AMBIGUITY_MARGIN (0.15)` instead of resolving a noise-level tie; same margin logic added inline to
Phần II true/false (both bubbles filled within margin → stays `null`, i.e. invalid double mark, no
credit either way). L-c: removed dead `trimEnd()`.

**marker-detection.js** — C6: `orderCornerPoints` replaced y-then-x sort (fails past ~45°) with
rotation-stable sum/diff rule (`TL=argmin(x+y)`, `BR=argmax(x+y)`, `TR=argmin(y-x)`,
`BL=argmax(y-x)`). `applyPerspectiveCorrection` now rejects `dstHeight <= dstWidth` (rotated-wrong
output) and `dstWidth/dstHeight < 30%` of image size (M8, degenerate corners) before allocating
transform Mats. 180° flip is **not** resolved — no asymmetric anchor on this sheet to disambiguate
geometrically (see Unresolved). H7: added `area > imageArea*0.95` reject next to the existing
`<0.1` guard (dark-background-behind-sheet no longer treated as the sheet). H1: dropped
`existingContours` reuse, `detectSheetContour`'s fallback call now `detectCornerMarkers(thresh, w,
h)` with no shared contours (see corner-marker-fallback.js). M7: `corners`/`edges` re-expressed in
warped coordinates after correction (was stale pre-warp coords next to a warped `boundingBox`).
Leaks: C4/L1 (`contours.get(i)` deleted every iteration via try/finally), L8 (`approx` leak on
`approxPolyDP`/`boundingRect` throw — try/finally), L9 (`contours`/`hierarchy`/`bestApprox` in
outer try/finally), L5 (`srcPts`/`dstPts`/`M` in finally, `corrected` deleted before rethrow on
`warpPerspective` throw).

**corner-marker-fallback.js** — H1: `detectCornerMarkers` always builds its own `RETR_LIST`
contours now (dropped `existingContours` param + its branch) — marker squares are nested inside the
sheet border and were excluded from the caller's `RETR_EXTERNAL` set, so reuse made `candidates`
almost always empty. Leaks: C4/L2 (`contours.get(i)` deleted every iteration), plus `contours`
MatVector itself is now deleted in a finally (was never deleted at all in the original — not in the
report's table but same class of bug, trivial to include here).

**image-quality-check.js** — L7: Laplacian/mean/stdDev Mats in try/finally (was only deleted on
success, swallowed by bare `catch{}`). L-b: `Infinity` sentinel replaced with `-1`
(`BLUR_CHECK_UNAVAILABLE`) — `Infinity` silently becomes `null` under `JSON.stringify`. L-d:
`markersFound` now falls back to `min(edges.length, 4)` when `corners` is empty, so a partial
fallback match (e.g. 3/4 corner markers found) is reported honestly instead of always "0/4". Typed
`markers` param as `MarkerDetectionResult` (was an inline `{ corners: Array }` missing `edges`, and
`Array` with no type argument — both were pre-existing type errors, fixed as a side effect).

**detection-pipeline.js** — L3/C5: `src`/`gray`/`thresh`/`corrected` declared before a try, released
in a single finally on every path (including throws inside `applyPerspectiveCorrection`,
`createDebugVisualization`, etc.) — previously only deleted on the happy path (~25MB/failed frame).
Wired the new `binThreshold` (from `computeGlobalThreshold`) through every detector call and
`computeAdaptiveThreshold`'s new `{threshold, reliable}` return. H2: `needsReview` (frozen contract
field) now set when `!reliable`, `!qualityReport.passed`, or any emitted field contains
`UNKNOWN_DIGIT` — a failing quality check or degenerate baseline is flagged for review rather than
silently graded (did not implement outright rejection — see below). H3: `confidence` is now derived
(`computeConfidence`: average best-vs-second-best margin across Phần I questions, forced to 0.3
when the baseline is unreliable) instead of the hardcoded `0.85` that had no consumer.

**debug-visualization.js** — H5: `createDebugVisualization` no longer draws onto an externally
supplied canvas. It now builds its own canvas directly from `gray` (`cv.imshow`) — the exact image
bubble coordinates were computed against, whether that's the downscaled `processCanvas` or the
perspective-warped Mat — so the overlay is always in the same coordinate space as detection,
regardless of photo resolution or whether correction was applied. **Signature change**:
`createDebugVisualization(bubbles, result, testConfig, gray, binThreshold)` — dropped the
`originalCanvas` param entirely (was param 1). M3: `drawPhanIIIAnswers` now matches
`bubble.charPosition`/`charValue` against `detected[bubble.charPosition]` instead of the dead
`bubble.digit` field (never emitted by the multi-char generator) compared against the whole
multi-char string — Phần III debug annotation was previously always-false dead code.

## Signature changes callers must reconcile

- `runDetectionPipeline(imageData, originalCanvas, testConfig)` — **unchanged** externally.
  `originalCanvas` is now used only as a truthy "want a debug overlay" flag; its pixel content is
  no longer drawn on. `ImageProcessor.jsx` (owned by another agent) still passes `canvas` and still
  works, but per H5's other half ("pass `processCanvas` at ImageProcessor.jsx:61") that caller no
  longer matters for correctness — my fix makes the coordinate-space bug impossible regardless of
  which canvas is passed, since we stopped drawing on it.
- `createDebugVisualization`: dropped `originalCanvas` (first param). Only called from
  `detection-pipeline.js` (mine) — no other caller found via grep.
- `detectStudentId`/`detectExamCode`/`detectPhanIAnswers`/`detectPhanIIAnswers`/
  `detectPhanIIIAnswers`/`measureBubbleFill`/`computeAdaptiveThreshold`: added trailing optional
  `binThreshold` param (default `DEFAULT_BIN_THRESHOLD = 200`, exported from
  `image-preprocessing.js`). Backward compatible — omitting it falls back to the neutral default
  (never exercised in production; the pipeline always supplies the real page-level value).
- `computeAdaptiveThreshold` return type: `number` → `{ threshold: number, reliable: boolean }`.
  Only caller is `detection-pipeline.js` (mine).
- `detectCornerMarkers(thresh, imageWidth, imageHeight)` — dropped 4th `existingContours` param.
  Only caller is `marker-detection.js` (mine).
- `ProcessingResult.needsReview` and `.confidence` are now meaningfully populated (frozen contract
  fields, no shape change).

## Typecheck / lint / build

- `npx tsc --noEmit --allowJs --checkJs --strict ... src/lib/*.js`: baseline 53 errors repo-wide
  (28 in the 8 files I own) → 26 after my changes (repo-wide total also 26, since no other
  currently-modified file in `src/lib/*.js` has errors). Net **-2** in my files, no net increase
  repo-wide. Remaining 26 are all pre-existing classes: `window.cv`/`self.cv` untyped global
  (no ambient `Window.cv` declaration exists in the project — out of scope to add), `@param
  {object}` typedef looseness on `testConfig`/`ProcessingResult` fields, and index-signature
  widening on `TrueFalseAnswer`/`Bubble` string keys. None are new logic errors.
- `npm run lint`: 0 errors, 4 pre-existing `no-img-element` warnings (not mine).
- `npm run build`: succeeds.
- Re-read every changed file; every `cv.Mat`/`MatVector` I allocate is released on every path
  (try/finally throughout, verified line-by-line above).

## Not done / explicitly deferred

- **180° flip detection (C6, second half)**: geometrically undetectable without an asymmetric
  anchor marker on the sheet (confirmed by inspecting the template — CV1239 has none). Left
  unresolved per the report's own admission (unresolved question 3); did not add a blanket
  "always flag corrected sheets" fallback since that would flag the large majority of normal scans
  and defeat the point of `needsReview`.
- **H2 as outright rejection**: implemented as "flag `needsReview`", not "return an error result
  instead of answers" — matches the task instruction's literal wording ("flagged for review rather
  than silently graded"), which is less drastic than the report's own suggested minimal fix.
  Flagged here in case a reviewer wanted the harder rejection behavior instead.
- **H3's exact formula** is a reasonable-but-not-validated heuristic (avg best-vs-second-best
  margin across Phần I). No fixture/scan exists to calibrate it against; flagged for later
  tightening once real scans are available.
- **M5** (confidence maps for Phần II/III): skipped — would change return shapes consumed by
  `manual-correction-modal.jsx`, which I don't own; not trivial.
- **M1, M2, M4, M6 (remaining), L-a, L-e**: not touched — cross-file impact (M1 config UI, M4
  UploadPage/manual-correction-modal, M6 remaining `window.cv` sites reverted deliberately to avoid
  a type-error regression — see below), or out of my file ownership (L-a duplicate function pair,
  L-e unused dependency).
- Deliberately **reverted** two of my own opportunistic M6 (`window.cv`→worker-safe) edits in
  `image-preprocessing.js`/`image-quality-check.js` and simplified a third in
  `debug-visualization.js`, because the `self||window` pattern doubles the "Property 'cv' does not
  exist" error count per site and the net effect pushed my file count above baseline. Kept the
  worker-safe pattern only in `computeGlobalThreshold` (genuinely part of the worker-documented
  pipeline) and where it already existed.

## For the reviewer to double-check

- `AMBIGUITY_MARGIN = 0.15` and the absolute-contrast gate (`max-min < 40`) are untuned constants
  (no fixture to calibrate against, per the report's own recommendation #8). Real scans may need
  different values.
- `BUBBLE_SIZE_RATIO = 0.016` was measured from the *template PDF render*, not an actual phone
  photo after perspective correction — real-world lens distortion/warp could shift this slightly;
  worth re-validating against a real photographed+corrected sheet if one becomes available.
- `needsReview` semantics (unreliable baseline OR failed quality OR any UNKNOWN_DIGIT) is a new
  aggregate the scoring/UI layer needs to actually act on — confirm the owning agent for
  `UploadPage.jsx`/`scoring.js` surfaces it to the teacher.

## Unresolved questions

1. Should H2 escalate from `needsReview: true` to outright excluding the sheet from
   `onResultsAdd` (report's original suggestion)? Left as a flag per the literal task wording;
   easy to tighten later since `needsReview` is already computed correctly.
2. Is `AMBIGUITY_MARGIN = 0.15` too aggressive for real (non-template) scans with more sensor
   noise? No fixture exists to validate against.
