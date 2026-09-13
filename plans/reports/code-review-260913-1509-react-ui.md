# Code Review — React/UI layer (chambai)

Date: 2026-09-13 · Scope: `src/app/{layout,page}.jsx`, `src/app/globals.css`, 13 components in `src/components/`
Method: full read of scoped files; `src/lib/*` read only at call-site signatures (`scoring.js`, `detection-pipeline.js`, `answer-detection.js`) to judge component contracts.
Verification run: `npm run lint` → 0 errors, 4 warnings (all pre-accepted `no-img-element`). No tests exist in the repo, so nothing here is test-verified; all findings are traced by code path.

## Overall

The UI is small, readable, and the data model is clean. The defects cluster in one place: **the batch-processing handshake in `UploadPage` + `ImageProcessor`**, built on a promise that only resolves if exactly one callback fires. Several plausible real-world events (CDN blocked, OpenCV WASM not initialized, corrupt photo, user removes a thumbnail, user clicks a nav tab) either hang the batch forever and drop every result in it, or push a malformed result that later crashes the results page permanently. Fix those before this touches a real class set.

Secondary themes: no modal a11y at all (grep for `aria-` across `src` returns zero hits), an unsaved-answer-key path that silently re-scores everyone after reload, and a dark-mode CSS rule that makes parts of the correction modal unreadable.

---

## CRITICAL

### C1. Poisoned "error" result crashes the Results page permanently
- `src/components/ImageProcessor.jsx:66` — on pipeline failure calls `onProcessingComplete({ error: true, errorMessage: err.message })`.
- `src/components/UploadPage.jsx:51-67` — the handler never checks `result.error`; it builds a normal result with `phanI/phanII/phanIII === undefined`, `processed: true`, pushes it into the batch, and `page.jsx:107` persists it to IndexedDB.
- `src/lib/scoring.js:57` — `scorePhanI` does `studentAnswers[i]` on `undefined` → `TypeError`, thrown inside `ResultsPage`'s `useMemo` (`ResultsPage.jsx:18-21`). There is no `src/app/error.jsx` and no boundary above `ResultsPage`.

Symptom: one unreadable photo (no corner markers, blurry sheet) makes "3. Kết quả" blank-screen the whole app. The bad row is already in IndexedDB, so reloading and reopening the session reproduces it forever — the teacher cannot reach any of the other 49 graded sheets. `errorMessage` is never shown.

Minimal fix: in `handleProcessingComplete`, branch on `result.error` — do not push a result; record the file in a failed list and surface it (`Không đọc được ảnh {fileName}: {errorMessage}. Vui lòng chụp lại.`). Still resolve `resolveRef` so the batch continues.

### C2. Batch handshake can hang forever; on hang or unmount every result in the batch is lost
`src/components/UploadPage.jsx:91-94`:

    for (let i = 0; i < selectedImages.length; i++) {
      setCurrentIndex(i);
      await new Promise((resolve) => { resolveRef.current = resolve; });
    }

Results live only in `resultsRef.current` and are handed to the parent at line 104, *after* the whole loop. Any path where an iteration never resolves loses the entire batch. Confirmed non-resolving paths:

1. `ImageProcessor.jsx:73` sets `img.src` with **no `img.onerror`** — a corrupt/truncated/mislabelled file never fires `onload`.
2. `ImageProcessor.jsx:18-26` — the injected script has **no `onerror`**; if `docs.opencv.org` is blocked or slow, `cvLoaded` stays false, the user sees "Đang tải OpenCV..." forever, no error, batch stalls.
3. A render crash caught by `ImageProcessorErrorBoundary` unmounts `ImageProcessor`; nothing resolves the pending promise.
4. `UploadPage.jsx:193` — if `currentIndex >= selectedImages.length` (see H1) the processor is not rendered at all.
5. `page.jsx:214` — `Navigation` is **not disabled during processing**. Clicking "3. Kết quả" or the session back-link unmounts `UploadPage` mid-batch; `setCurrentIndex` on an unmounted tree is a no-op, so the loop never advances and `onResultsAdd` never runs. 40 already-processed sheets are discarded silently.

Symptom: "Đang xử lý..." with a frozen progress bar and a permanently disabled button; refresh is the only exit, and all work since the batch started is gone.

Minimal fix (three small pieces, both files):
- Persist incrementally: call `onResultsAdd([newResult])` per image instead of once at the end (the parent already appends, `page.jsx:112`).
- Add a per-image timeout/`reject` plus `img.onerror` and `script.onerror` handlers that resolve with an error marker.
- Disable the nav buttons and the thumbnail remove buttons while `processing`, and add a `beforeunload` guard while a batch runs.

### C3. OpenCV readiness is tested with `window.cv`, which is truthy before the WASM runtime initializes
`src/components/ImageProcessor.jsx:12-16` sets `cvLoaded = true` as soon as `window.cv` exists. `src/app/layout.jsx:26-29` already loads `opencv.js` with `strategy="beforeInteractive"`, so `window.cv` is defined at hydration while the WASM module may still be compiling. `runDetectionPipeline` (`detection-pipeline.js:24`) then calls `cv.matFromImageData`, undefined until `onRuntimeInitialized` → `TypeError` → C1's poisoned result.

Symptom: on a cold load / slow machine, the first image (or the whole batch) fails with results that then crash the results page. Non-deterministic, which makes it worse.

Minimal fix: probe for an actual API, not the namespace: `const ready = typeof window.cv?.Mat === 'function'` (or `cv.getBuildInformation`); otherwise register `window.cv.onRuntimeInitialized = () => setCvLoaded(true)`. While here, delete the duplicated CDN `<script>` injection at `ImageProcessor.jsx:18-26` — `layout.jsx` already owns loading, and this second tag is a parallel reimplementation that can trigger a second ~9 MB download and a second module instance.

---

## HIGH

### H1. Removing a thumbnail during processing duplicates/misattributes results or hangs the batch
`UploadPage.jsx:154-157` renders `ImageThumbnail` with an always-enabled remove button, even while `processing`. `removeImage` replaces `selectedImages` → `handleProcessingComplete` identity changes (deps at line 73) → `processImage` identity changes (`ImageProcessor.jsx:78`) → the effect at `ImageProcessor.jsx:80-84` re-runs and **reprocesses the currently mounted image**, pushing a duplicate row and resolving the loop early (so the next image is skipped). If the removal makes `currentIndex >= selectedImages.length`, the processor unmounts and the batch hangs (C2 path 4).

Symptom: duplicate students, a skipped sheet, and wrong `fileName` attribution (line 54 reads the *current* array by index).

Minimal fix: `disabled={processing}` on the remove button; snapshot the file list into a ref at the start of `processImages` and drive the loop and `fileName` from that snapshot.

### H2. Answer-key edits are never persisted unless "Lưu cấu hình" is clicked — scores silently change after reload
`page.jsx:166` passes `onConfigChange={setConfig}`: every edit updates in-memory config only. `handleConfigSave` (`page.jsx:96`) is the only writer to IndexedDB. `configSaved` (`page.jsx:32`) is set once and never cleared on edit, so `Navigation` keeps showing step 1 as done (`Navigation.jsx:3`). `ResultsPage` re-scores every student against the *current* config on each render (`ResultsPage.jsx:18-21`).

Symptom: teacher tweaks the key, grades 40 sheets, closes the laptop. After reload the session's stored (old) key is used and every printed/exported score differs from what was on screen. No warning at any point.

Minimal fix: track dirty state — if the config differs from `activeSession.config`, set `configSaved(false)` and show `Cấu hình chưa được lưu` on the nav step; or auto-save (debounced) since a session already exists to write into.

### H3. IndexedDB write failures are swallowed — corrections and results appear saved but are not
`page.jsx:107-126`: `await saveResults(...)` in async handlers with no `try/catch` and no user feedback; `page.jsx:73` `saveSession` likewise. On quota exhaustion (debug images are stored per result and a 50-sheet session gets large) or private-browsing restrictions the promise rejects, the UI already shows the updated state, and the rejection surfaces only as an unhandled rejection in the console.

Symptom: teacher makes 20 manual corrections, everything looks right, reload loses them.

Minimal fix: wrap persistence in `try/catch` and surface a blocking Vietnamese message on failure (`Không lưu được kết quả vào bộ nhớ trình duyệt. Vui lòng xuất CSV ngay để tránh mất dữ liệu.`).

### H4. Non-JPEG/PNG files are dropped with no message
`UploadPage.jsx:26-34`: the filter keeps only `image/jpeg`/`image/png`; when nothing survives the function does nothing — no state change, no status message. iPhone photos (`image/heic`), `.webp`, and files whose `type` is empty (common for drag-and-drop from some file managers) all vanish.

Symptom: teacher drags 30 phone photos, the page looks unchanged, no explanation.

Minimal fix: compare counts and report `Đã bỏ qua {n} file không phải JPG/PNG.`; consider accepting any `file.type.startsWith('image/')`.

### H5. Modals are inaccessible and not keyboard-operable
`manual-correction-modal.jsx:60` and `student-detail-modal.jsx:32` are plain `div` overlays. Missing `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, Escape-to-close, initial focus, focus trap, focus restore on close, and background scroll lock (the page behind scrolls under the overlay). Close buttons are bare `&times;` with no accessible name (`manual-correction-modal.jsx:74`, `student-detail-modal.jsx:47`).

Symptom: Escape does nothing, Tab walks out of the modal into the table behind it, scrolling the modal spills into the page, and the close control is announced as "×".

Minimal fix: one effect per modal — `role="dialog" aria-modal="true" aria-labelledby={titleId}`, a `keydown` listener for `Escape` → `onClose`, `document.body.style.overflow='hidden'` with restore on unmount, focus the dialog on mount and restore the previously focused element on unmount, `aria-label="Đóng"` on the × button.

### H6. Dark OS theme makes parts of the modals and pages unreadable
`globals.css:15-20` flips `--foreground` to `#ededed` under `prefers-color-scheme: dark`, and `body` inherits it (`globals.css:22-26`). Every surface is a hardcoded light class (`bg-white`), and several text nodes carry **no** color class, so they inherit near-white on white:
- `manual-correction-modal.jsx:65` (`Sửa đáp án - SBD: …`), `:122`/`:164`/`:194` section headings, `:168` `Câu {i+1}:`, `:210` the Phần III input text.
- `student-detail-modal.jsx:37`, `:63`, `:82`, `:86`, `:105`.
- `UploadPage.jsx:152`, `:202`; `ResultsPage.jsx:207`.

Symptom: any teacher whose OS is in dark mode sees invisible headings and cannot read the question numbers in the correction grid.

Minimal fix: drop the dark `prefers-color-scheme` block (the app is light-only by design), or set an explicit `color: #171717` on the app container. Note `globals.css:25` also overrides the Geist fonts loaded in `layout.jsx` with Arial.

---

## MEDIUM

### M1. Print stylesheet hides all buttons globally and misses the nav
`globals.css:30`: `nav, button, .no-print { display: none !important; }`.
- No `<nav>` element exists — `Navigation.jsx` renders `div`s — so the step bar and `SessionHeader` print on every page.
- `button` is global, so printing the configuration page prints an empty answer key: the whole Phần I grid is buttons (`phan-i-answer-grid.jsx:55`), as are Phần II's Đúng/Sai controls (`ConfigurationPage.jsx:223-236`).

Fix: hide `.no-print` only, add `.no-print` to the `Navigation`/`SessionHeader` roots, and render the key as text for print.

### M2. Long results tables print badly
`globals.css:34`: `table { page-break-inside: avoid; }` on a 50-row table asks the browser to push the whole table to a fresh page, and the header row is not repeated.
Symptom: blank first page and/or headerless continuation pages.
Fix: `thead { display: table-header-group; } tr { page-break-inside: avoid; }` and drop the table-level rule.

### M3. Low-confidence highlighting misses the case it exists for
`manual-correction-modal.jsx:129-130`:

    const selectedFill = answer ? (qConf[answer] || 0) : 0;
    const isLowConf = answer && selectedFill > 0.25 && selectedFill < 0.45;

When a mark is too faint to cross the fill threshold, `answers[q]` comes back `''` (`answer-detection.js:85`) — exactly the case a human must review — and the highlight is skipped because `answer` is falsy.
Symptom: blank questions caused by a faint pencil look identical to genuinely unanswered ones; no cue to check them.
Fix: when `answer` is empty, take `Math.max(...Object.values(qConf))` and highlight if it lands in the same 0.25–0.45 band. Add a non-color cue (`⚠` + `title="Độ tin cậy thấp"`), since today it is a yellow tint only (`:133`).

### M4. Correction modal grids iterate detected answers, not the configured question count
`manual-correction-modal.jsx:124` (`answers.map`), `:166`, `:196`. If the key is extended after images were processed (40 → 45), questions 41-45 are absent from the correction UI while `scorePhanI` counts them against the student (it loops over `correctAnswers.length`, `scoring.js:56`).
Symptom: students lose points on questions the teacher cannot correct.
Fix: render `Array.from({ length: testConfig.phanI.questionCount })` and read `answers[i] ?? ''`.

### M5. Phần II correction buttons are colored by "matches key", which reads as "this is the student's answer"
`manual-correction-modal.jsx:170-181`: every sub-option is green or red, no neutral state. If the Phần II key is unset, `correct` is `undefined`, `answer[opt] === correct` is false, and **all four options render red** — the sheet looks entirely wrong. Same pattern at `student-detail-modal.jsx:88-93`.
Fix: when `correctAnswers[i]?.[opt] === undefined`, render the neutral gray style (matching the legend's "Trống" entry at `:83`).

### M6. Sortable table headers are mouse-only
`ResultsPage.jsx:242` (`ThBtn`) and `item-analysis-view.jsx:102-106` attach `onClick` to a `<th>` with no `tabIndex`, `role="button"`, or key handler. Keyboard users cannot sort by score.
Fix: put a real `<button>` inside the `<th>`; add `aria-sort`.

### M7. Thumbnail remove button is invisible until hover
`UploadPage.jsx:272-275`: `opacity-0 group-hover:opacity-100`, no `focus:opacity-100`, no `aria-label`, label is a literal `X`.
Symptom: on a touchscreen/tablet or by keyboard there is no way to discover or reach the remove control.
Fix: add `focus-visible:opacity-100`, `aria-label={`Xóa ${file.name}`}`, and keep it visible below `md`.

### M8. Answer grid exposes no semantics or pressed state
`phan-i-answer-grid.jsx:45-50`: the focusable wrapper is a bare `div tabIndex={0}` with no `role`/`aria-label`; the option buttons (`:55`, `tabIndex={-1}`) never expose `aria-pressed`. Selection is conveyed only by background color (`:60-62`).
Symptom: a screen reader announces "group, blank"; the keyboard hint at `ConfigurationPage.jsx:143` is undiscoverable.
Fix: `role="group" aria-label={`Câu ${i + 1}`}` on the wrapper, `aria-pressed={answers[i] === option}` on each button.

### M9. Every configuration keystroke re-renders the whole configuration page
`ConfigurationPage.jsx:26-56` lifts all edits to `page.jsx` `setConfig`, so typing one character in a Phần III answer re-renders `ScoringConfig`, the 40-question `PhanIAnswerGrid` (~200 buttons), `PhanIISection` (up to 50 × 8 buttons) and `PhanIIISection`. On the modest hardware this app targets, typing lags at higher question counts.
Fix: `memo()` the four subsection components and wrap the update callbacks in `useCallback` (they are recreated every render today).

### M10. Batch preview renders every full-resolution debug image at once
`UploadPage.jsx:200-228` keeps all results (including `debugImageUrl` data URLs built from the *original* canvas) in state and renders each one inline; `ImageProcessor.jsx:103` renders another copy for the current image.
Symptom: memory climbs through a 50-sheet batch, scrolling stutters, and on low-RAM machines the tab can be killed — taking the un-persisted batch with it (C2).
Fix: render the debug image only for the last N results, or collapse each behind a "Xem ảnh debug" toggle; they are already persisted in IndexedDB and viewable per student.

### M11. Config mutation writes through into the active session object
`ConfigurationPage.jsx:32-39`: `newAnswers[questionIndex][option] = value` copies the array but mutates the nested answer object, which is shared with `activeSession.config` (`page.jsx:53` assigns the loaded object by reference) and with the module-level `DEFAULT_CONFIG` sub-objects for new sessions (`page.jsx:15-24`, `:69`).
Symptom: "unsaved" Phần II edits leak into the in-memory session object, so a later unrelated `saveSession` can persist changes the teacher never confirmed; `DEFAULT_CONFIG` becomes shared mutable state across sessions in one tab.
Fix: `newAnswers[questionIndex] = { ...(newAnswers[questionIndex] ?? { a: false, b: false, c: false, d: false }), [option]: value }`, and deep-copy `DEFAULT_CONFIG` at each use.

### M12. No cancellation or unmount guard in `ImageProcessor`
`ImageProcessor.jsx:29-84`: the `img.onload` closure runs regardless of unmount and calls `setDebugImageUrl`/`onProcessingComplete` afterwards; the loader effect (`:12-27`) has no cleanup. Combined with C2 this is how a navigated-away batch keeps a decoded full-res canvas and an OpenCV pipeline alive with nowhere to deliver results.
Fix: a `let cancelled = false` captured by the effect, checked before every `set*`/callback, flipped in the cleanup.

### M13. `react-hooks/set-state-in-effect` is disabled project-wide
`eslint.config.mjs` turns the rule off. The three effects it would flag — `ImageProcessor.jsx:14`/`:23` and `UploadPage.jsx:261` — are exactly where C3 lives. The suppression removes signal from the one subsystem that needs it.
Fix: re-enable and scope an inline disable to `UploadPage.jsx:259-263` (the object-URL effect, which is legitimate).

---

## LOW

- `UploadPage.jsx:155` / `:205` use array index as key. For `selectedImages` the list supports deletion, so React re-associates `ImageThumbnail` instances; the `[file]` effect at `:259` prevents visible breakage but forces an unnecessary revoke/recreate of every object URL after each removal. Use `${file.name}-${file.lastModified}`.
- `item-analysis-view.jsx:16-29`: `filtered` is computed outside `useMemo` but used as a dependency of the `sorted` memo, so `sorted` recomputes on every render. Move the filter inside the memo.
- `UploadPage.jsx:180`: `Đang xử lý ảnh {processedResults.length + 1}/{n}` shows `n+1` on the final tick (e.g. "51/50"). Clamp with `Math.min`.
- `UploadPage.jsx:130` and `ConfigurationPage.jsx:76`: status banners are plain divs; add `role="status"` so screen readers announce "Đã dán 40 đáp án" and processing errors.
- `ConfigurationPage.jsx:95`, `:105`, `:116`, `:186`, `:205`, `:253`: `<label>` elements with no `htmlFor`/`id` pairing; clicking a label does not focus its input.
- `ConfigurationPage.jsx:47`: reducing `questionCount` leaves orphaned entries in `config.phanI.answers`; restoring the count silently restores old answers. Truncate on decrease.
- `manual-correction-modal.jsx:55` persists a `score` snapshot onto the result while `ResultsPage.jsx:20` always recomputes — two sources of truth; the stored one goes stale after any scoring-config change.
- `phan-i-answer-grid.jsx:47`: `questionRefs.current` is never trimmed when `questionCount` shrinks, leaving stale detached nodes in the array.
- Naming is split between PascalCase (`UploadPage`, `ImageProcessor`, `ResultsPage`, `ConfigurationPage`, `Navigation`) and kebab-case (the newer eight). Pick one and rename in a dedicated commit — noted once, not repeated per file.

---

## Manual-correction flow (dedicated section)

Path: `ResultsPage` row "Xem" (`ResultsPage.jsx:159`) → `StudentDetailModal` → "Sửa đáp án" (`student-detail-modal.jsx:42`) → `ManualCorrectionModal` → save → `ResultsPage.jsx:188-192` → `page.jsx:120` → IndexedDB. This is the interaction a teacher repeats dozens of times per class; it currently has the weakest guarantees in the app.

1. **The scanned sheet disappears exactly when it is needed.** `student-detail-modal.jsx:20-29` early-returns `ManualCorrectionModal`, unmounting the detail view including the debug image (`:123-128`). To verify a doubtful bubble the teacher must cancel the correction, look at the image, and reopen — losing any edits already made (see 2). Fix: pass `debugImageUrl` into `ManualCorrectionModal` and render it in a collapsible side pane.
2. **Edits are discarded with no confirmation.** `manual-correction-modal.jsx:74` (×) and `:106` (Hủy) both call `onClose` directly; local `phanI/phanII/phanIII` state is dropped. A misclick on × after correcting 15 answers loses all of them. Fix: track a dirty flag (compare against the `student` prop) and `confirm('Bỏ các thay đổi chưa lưu?')` before closing — the same guard should cover Escape once H5 adds it.
3. **Saving closes the modal and returns to the table** (`ResultsPage.jsx:191` `setSelectedStudent(null)`). Correcting a class means table → row → detail → correct → save → table, repeatedly. Fix (small): keep the detail modal open on the updated student after save, and add "Học sinh trước / sau" navigation driven by `sortedResults`.
4. **Silent persistence failure** — see H3; the highest-value keystrokes in the app are the ones with no write-failure feedback.
5. **The review cue misses faint marks** — see M3. Since manual correction exists mainly to fix low-confidence detections, this is the flow's core defect.
6. **Phần II is colored all-red when its key is unset** — see M5; teachers will read that as "the student got everything wrong".
7. **No keyboard path.** `PhanIGrid` renders 4 buttons per question (`manual-correction-modal.jsx:143`), so reaching question 37 takes ~148 Tab presses. `phan-i-answer-grid.jsx` already implements the right interaction (type A/B/C/D, auto-advance, arrows). Fix: reuse that keydown approach in the modal's `PhanIGrid` instead of maintaining two near-duplicate grids.
8. **No `aria-modal`/Escape/focus trap/scroll lock** — see H5.
9. `liveScore` (`:19-22`) lists `student` in its dependency array; `student` identity changes on every parent re-render, so the memo rarely hits. Use `student.id`.

---

## Recommended order

1. C1 + C3 — stop poisoned results being created and persisted; fix the OpenCV readiness probe. (Highest blast radius: unrecoverable session.)
2. C2 + H1 — incremental persistence per image, `img.onerror`/`script.onerror`/timeout, disable nav and thumbnail removal while processing, `beforeunload` guard.
3. H3 + H2 — surface storage failures; stop silent answer-key divergence after reload.
4. H5 + H6 — modal semantics/Escape/focus/scroll-lock; remove the dark-scheme block.
5. H4, M3, M4, M5 — correction-flow correctness and the batch-intake message.
6. M1/M2 print rules, then the remaining MEDIUM/LOW items.

## Metrics

- Files reviewed: 16 (~1,890 LOC incl. `globals.css`).
- Lint: 0 errors, 4 warnings — all pre-accepted `no-img-element`. One rule (`react-hooks/set-state-in-effect`) is disabled project-wide; see M13.
- Type coverage: JSDoc + `checkJs` is configured in `jsconfig.json`, but none of the 13 reviewed components declare prop types, so props cross every component boundary untyped (this is how `result.error` at C1 passes unnoticed). No `typecheck` script exists in `package.json`.
- Test coverage: 0 — the repository contains no tests and no test runner.
- `aria-*` attributes in `src`: 0.

## Unresolved questions

1. Is `strategy="beforeInteractive"` in `layout.jsx` intentional (blocks hydration on a ~9 MB CDN download), or leftover? It also makes `ImageProcessor`'s own loader dead code in the happy path.
2. Is offline / blocked-CDN use expected (school networks often filter)? If so the OpenCV build should be vendored under `public/` instead of `docs.opencv.org`.
3. Should a batch be persisted incrementally (my C2 recommendation), or is the all-or-nothing commit deliberate so a partial batch never pollutes a session?
4. `detectPhanIIAnswers`/`detectPhanIIIAnswers` return no confidence map, so those sections have no review cue at all. Intentional for now?
5. Is the dark `prefers-color-scheme` block wanted at all, or is light-only the product decision? (Determines whether H6 is a deletion or a full dark theme.)
6. Intended behaviour when the question count changes after images are processed — re-score against the new key (today's behaviour), or lock the key per session?
