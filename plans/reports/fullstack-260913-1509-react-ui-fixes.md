# React/UI fixes — implementation report

Date: 2026-09-13. Scope: files listed in the task's File Ownership (src/app/{layout,page,globals.css,error}, all src/components/**). src/lib/** read-only (owned by concurrent agents).

## Status: all CRITICAL + HIGH implemented. See "Not done / deferred" for the few MEDIUM/LOW items skipped and why.

## Files changed

New:
- `src/components/opencv-loader.jsx` — single OpenCV `<Script>` injection point (client component, so `onError` works while `layout.jsx` stays a server component with `metadata`).
- `src/components/modal-shell.jsx` — shared dialog shell: `role="dialog"`, `aria-modal`, focus trap, Escape-to-close, scroll lock, focus restore. Used by both modals (H5, DRY).
- `src/components/highlight-unknown.jsx` — renders a string with `UNKNOWN_DIGIT` ('?') positions highlighted amber, used everywhere SBD/mã đề/Phần III values are displayed.
- `src/app/error.jsx` — root error boundary (Next.js App Router convention); a crash no longer blank-screens the app with no way back to other sessions.

Rewritten:
- `src/components/ImageProcessor.jsx`, `src/components/UploadPage.jsx`, `src/components/manual-correction-modal.jsx`, `src/components/student-detail-modal.jsx`, `src/components/phan-i-answer-grid.jsx` (now shared), `src/components/ResultsPage.jsx`, `src/components/Navigation.jsx`, `src/components/session-header.jsx`, `src/app/page.jsx`.

Edited:
- `src/components/image-processor-error-boundary.jsx` (added `onError` prop), `src/components/ConfigurationPage.jsx` (truncation, mutation fix, scoring label, ids), `src/components/item-analysis-view.jsx` (memo fix, sortable `<button>`+`aria-sort`), `src/components/score-distribution-chart.jsx` (heading color), `src/app/layout.jsx` (OpenCvLoader), `src/app/globals.css` (dark-mode block removed, print rules fixed).

## Per-finding changes

**C1 (poisoned error result).** `ImageProcessor` never mixes an `{error}` outcome into a scored result. `UploadPage.handleProcessingComplete` branches on `result.error` first: records `{fileName, errorMessage}` in a `failedItems` map, shows it on the thumbnail, never adds it to `processedResults`/never calls `onResultsAdd`. `ResultsPage` also defensively guards `r.error` rows already sitting in old IndexedDB data (never calls `calculateScore` on them; renders a red "Lỗi xử lý" row with a delete button) so an already-corrupted session self-heals instead of crashing forever.

**C2 (batch hang / all-or-nothing loss).**
- Incremental persistence: `UploadPage` calls `onResultsAdd([newResult])` per completed image; `page.jsx` merges into the full array and does one atomic `replaceSessionResults` write per completion (see item 3 below) — an interruption loses at most the one sheet in flight.
- `img.onerror` added (corrupt/truncated file) → settles with an error marker.
- Script load failure → `window.__opencvLoadFailed` + `opencv-load-error` window event → `ImageProcessor` settles every queued image with an error instead of an indefinite spinner.
- `ImageProcessorErrorBoundary` gained an `onError` prop; `componentDidCatch` calls it so a render crash still resolves the pending slot. The boundary (and `ImageProcessor`) are keyed by `fileKey(file)` so a crash on one image doesn't poison every subsequent image's boundary state.
- Per-image 60s timeout in `UploadPage.waitForSlot` — a bound, not indefinite, worst case if something truly never calls back.
- Nav (`Navigation`, `SessionHeader`'s back link) is disabled while `processing` (lifted via `onProcessingStateChange`/`batchProcessing` in `page.jsx`), and a `beforeunload` guard warns on tab close mid-batch.

**C3 (OpenCV readiness race + duplicate load + CDN).**
- Removed the duplicate script injection from `ImageProcessor.jsx` entirely; `layout.jsx` now renders a single `<OpenCvLoader />` (jsDelivr URL + exact SRI hash + `crossOrigin="anonymous"` as specified).
- Readiness probe is `typeof window.cv?.Mat === 'function'`, not truthy `window.cv`; if `window.cv` exists but isn't ready, waits on `onRuntimeInitialized` (chaining any prior handler); if the script hasn't executed yet, polls briefly. `onError` marks a global flag + event so every `ImageProcessor` instance (even ones created before/after the failure) picks it up.

**H1 (remove-during-processing race).** Remove button is `disabled={processing}`. The batch loop snapshots `selectedImages` into `filesSnapshot` at start and drives `fileName`/index solely from `currentFileRef` (set once per iteration), not from live `selectedImages`/`currentIndex` reads — identity churn in `selectedImages` can no longer misattribute a result.

**H2 (unsaved key silently re-scores).** `page.jsx.handleConfigChange` sets `configSaved(false)` on every edit; `configSaved` only flips true again after a confirmed `saveSession` write. `Navigation` disables step 2/3 while unsaved and shows "Cấu hình chưa được lưu" on step 1.

**H3 (swallowed IndexedDB failures).** All page.jsx persistence goes through `runPersist(fn, message)` (try/catch + a dismissible red `role="alert"` banner with a concrete Vietnamese message, e.g. "Không lưu được kết quả... Vui lòng xuất CSV ngay"). Applied to session create/delete/list-reload/config-save/results-add/results-update/results-clear/reset-all. `UploadPage`'s own incremental persistence also catches and surfaces failures per image.

**H4 (dropped non-JPEG/PNG files silently).** `isImageFile` accepts any `image/*` type, falls back to extension sniffing (jpg/png/webp/heic/heif) when `file.type` is empty (common for some file managers). Skipped-file count is reported: "Đã bỏ qua {n} file không phải ảnh."

**H5 (modal a11y).** `ModalShell` gives both modals `role="dialog"`, `aria-modal`, `aria-labelledby`, a focus trap, Escape-to-close (routed through the correction modal's dirty-check), background scroll lock, and focus restore on close. Close buttons now have `aria-label="Đóng"`.

**H6 (dark mode).** Removed the `prefers-color-scheme: dark` block in `globals.css` (app is light-only by design, per the report's minimal-fix option) and additionally added explicit `text-gray-900` to every heading that previously had no color class (defense in depth, cheap since those files were already being edited).

**#6 Question-count truncation.** `ConfigurationPage.updateQuestionCount` truncates `answers` to the new count and, if any of the discarded entries had a real answer, asks `confirm(...)` before applying.

**#7 CSV injection (coordinator follow-up).** `ResultsPage.exportToCSV` now escapes every field: wraps in quotes (doubling embedded quotes) when a comma/quote/newline is present, and prefixes a leading `=`/`+`/`-`/`@`/tab/CR with `'` so Excel/Sheets never executes it as a formula. UTF-8 BOM kept.

**#8 Manual-correction flow.**
- Debug image no longer disappears: `StudentDetailModal` passes `debugImageUrl` into `ManualCorrectionModal`, which shows it behind a "Xem ảnh gốc" toggle.
- Dirty-state confirm: `isDirty` compares current edit state to the original student; Escape/×/Hủy all route through `requestClose`, which confirms before discarding.
- Low-confidence-for-blanks (M3): when a question is blank, the grid now takes `Math.max` over all four options' fill confidence (not just the selected one, since there is none) and flags it the same way, plus a non-color `⚠` cue.
- Phần II blank vs unset-key vs wrong (tri-state + M5): rewritten as an explicit 3-way state (Đúng/Sai/Trống) per sub-item; neutral gray whenever the key itself is unset for that sub-item, distinct gray "trống" for a genuinely blank (`null`) student answer — never red for either.
- Keyboard grid (148-Tab problem): `ManualCorrectionModal`'s Phần I grid now reuses the shared `PhanIAnswerGrid` (type A/B/C/D, auto-advance, arrow-key navigation) instead of a separate mouse-only grid.
- Stays on the corrected student after save (`ResultsPage` no longer calls `setSelectedStudent(null)` from the correction-save path) — small, from the report's dedicated section.
- `liveScore` no longer depends on the whole `student` object (only `phanI/phanII/phanIII` feed `calculateScore`), so the memo isn't invalidated by unrelated parent re-renders.

**M4 (grid bound by detected answers, not config).** All three correction grids now render `Array.from({ length: testConfig.<phan>.questionCount })`, reading `answers[i] ?? default`.

**M11 (shared-reference mutation).** `ConfigurationPage.updatePhanIIAnswer` copies the sub-option object instead of mutating in place. `page.jsx`'s `DEFAULT_CONFIG` is deep-cloned (`cloneDefaultConfig()`) at every use (new session, reset) instead of handed out by reference.

**Coordinator follow-ups from the scoring/storage agent's landed work:**
- `page.jsx` now uses `replaceSessionResults(sessionId, list)` for every results write (add/update/clear/reset) instead of `saveResults` — atomic clear+rewrite in one IndexedDB transaction.
- `saveSession`'s return value (`Promise<SessionRecord>`) is captured everywhere it's called and used to update `activeSession`/`sessions` (create, config-save, reset-all), instead of re-assembling the record locally.
- `ScoreResult.legacyPhanII`: `ResultsPage` shows an amber banner when any scored result carries `legacyPhanII`, explaining the session predates the CV1239 tier fix and that its grades are intentionally frozen to the old formula.
- `config.schemaVersion` vs `SCHEMA_VERSION` (types.js): `SessionHeader` shows a "⚠ Phiên bản chấm cũ" badge when the session's stamped version is older than current.
- `ConfigurationPage`'s Phần II scoring input relabeled "điểm tối đa/câu, khi cả 4 ý đúng" and now displays/edits the actual per-question maximum (`pointsPerQuestion × 4`), with a note that the 10/25/50/100% tier split is fixed by CV1239, not user-adjustable. (Storage field `pointsPerQuestion` is unchanged — `scoring.js` still divides by 4 internally — only the label and the number shown to the teacher changed.)
- Fixed the reported lint ERROR in `ImageProcessor.jsx` (`react-hooks/refs`: a ref was written during render) by moving that sync into a bare `useEffect`. Fixed the new `opencv-loader.jsx` `@next/next/no-before-interactive-script-outside-document` warning with a narrowly-scoped, justified inline disable (the rule is a file-location heuristic; the script genuinely is rendered directly in `RootLayout`'s body).

## Not done / deferred (with reason)

- **M13** (re-enable `react-hooks/set-state-in-effect` project-wide) — lives in `eslint.config.mjs`, a root config file outside my File Ownership. Flagging for whoever owns that file.
- **M9** (memoize the four ConfigurationPage subsections) — real but moderate refactor (wrap 4 components + their callbacks); not touched since it wasn't blocking correctness and the phase was already large. Typing lag on the 40-question grid is unchanged from before.
- **M10** (bound debug-image memory) — partially addressed: `UploadPage`'s "Kết quả xử lý" list now renders each debug image behind a "Xem ảnh debug" toggle (collapsed by default) instead of always rendering all of them inline, which is the main mitigation. Did not add a hard cap on rendered thumbnails/expanded count beyond that.
- Prev/Next student navigation inside the correction flow (report's item 3, "add Học sinh trước/sau") — not implemented; only the cheaper "stay open after save" half was done. Full list-driven prev/next needs `sortedResults` threaded into the modal, which felt like scope beyond what the task's top-level list asked for.
- A few LOW items left alone as genuinely low-value/no-op given other fixes: stale `questionRefs.current` array on shrink, and the `manual-correction-modal` local `score` snapshot going stale (harmless — `ResultsPage` always recomputes from config, never reads the stored value for scoring).

## Verification

1. `npm run lint` — 0 errors, exactly the 4 accepted `@next/next/no-img-element` warnings (`ImageProcessor.jsx`, `UploadPage.jsx` ×2, `student-detail-modal.jsx`). A 5th, new `<img>` I added in `manual-correction-modal.jsx` ("Xem ảnh gốc" toggle, also a generated data URL next/image can't optimize) carries a scoped `eslint-disable-next-line` with justification, kept out of the "4 accepted" count deliberately since it's new scope, not a pre-existing accepted item.
2. `npm run build` — succeeds (Turbopack compile + static generation, both routes).
3. `npx tsc --noEmit --allowJs --checkJs --strict --jsx react-jsx --target es2022 --module esnext --moduleResolution bundler --skipLibCheck src/components/*.jsx src/app/*.jsx`:
   - **Baseline (git HEAD, same files, copied into the project tree so module resolution is apples-to-apples): 897 errors.**
   - **After this pass: 993 errors (+96).**
   - Root cause of the delta, verified by breaking down every error code: **99% of the increase is `TS7026` ("JSX element implicitly has type any") and `TS7006`/`TS7031`  (implicit-any callback params / destructured props)** — categories that fire on *every* JSX tag and *every* untyped function parameter in the whole file, because this project has no `@types/react` anywhere in `node_modules` (confirmed) and the invocation has no path-alias/tsconfig wiring. These counts are structurally proportional to how much JSX/code exists in a file, not a signal of new type-unsafety — the same two categories already accounted for 636 and 119+79 of the 897 baseline errors respectively, on unmodified code.
   - I did fix every error in the categories that were **not** pure environmental noise: `TS2739` (missing-prop mismatches from optional destructured props) went from 3 to 0 by giving `PhanIAnswerGrid`/`Th`/`Td` proper JSDoc `@param [x]` optional annotations instead of runtime `= undefined` defaults (which would have collapsed their inferred type to literal `undefined` — tried, reverted, this was the correct fix); `TS2339` dropped 7→3 (fixed a pre-existing `FileReader.result` `.trim()` type error in `ConfigurationPage`, and scoped `any` casts with a one-line justification comment for the two legitimate `window.cv`/`window.__opencvLoadFailed` global accesses in `ImageProcessor`/`opencv-loader`); remaining `TS2339` (3) and `TS18046` (2) are pre-existing patterns in files I didn't touch (`session-list.jsx`) or in `image-processor-error-boundary.jsx`'s `this.props`/`this.setState` (present at baseline too, `Component` from `'react'` is untyped without `@types/react`).
   - **I could not get the raw total back under baseline without either (a) adding `@types/react` (barred: "no new dependencies") or (b) cutting required scope (more JSX for a11y/tri-state/keyboard nav/banners is exactly what the task asked for).** Flagging this explicitly rather than silently claiming compliance, per the instruction to report honestly. `npm run build`'s own "Running TypeScript" step (which uses the project's real `jsconfig.json`) stays clean throughout, for what it's worth as a second signal.
4. Batch-processing settle-branch trace (hand-traced, `src/components/UploadPage.jsx` + `ImageProcessor.jsx`):
   - Success: `img.onload` → pipeline succeeds → `onProcessingComplete(result)` → `handleProcessingComplete` → `settleCurrentSlot()`.
   - Pipeline throws inside `img.onload`'s try/catch → `onProcessingComplete({error})` → same settle path.
   - `img.onerror` (corrupt/unreadable file) → `onProcessingComplete({error})` → same settle path.
   - OpenCV script `onError` (CDN blocked) → `window.__opencvLoadFailed` + event → every mounted/future `ImageProcessor` sets `cvLoadError` → dedicated effect calls `onProcessingComplete({error})` per queued image → same settle path.
   - Render crash anywhere under `ImageProcessorErrorBoundary` → `componentDidCatch` → `onError` prop (`handleBoundaryError`) → `settleCurrentSlot()` directly.
   - Nothing ever fires (true hang, e.g. WASM compiles forever) → `waitForSlot`'s 60s `setTimeout` fires regardless → marks the item failed → loop advances. Bounded, not infinite.
   - Index-overflow (`currentIndex >= selectedImages.length`) — structurally can't happen mid-loop anymore since `selectedImages` is not mutated during the loop (remove disabled while `processing`, and the array is only filtered *after* the loop finishes); if it ever did, the 60s timeout still bounds it.
   - Nav/back unmounting `UploadPage` mid-batch — prevented structurally (`Navigation`/`SessionHeader` disabled via `locked`/`disabled` while `processing`); there is no browser-level routing in this single-page app to bypass it via back/forward.
   - Every one of the above either calls `handleProcessingComplete`/`handleBoundaryError` (which always call `settleCurrentSlot()`) or hits the timeout, so every iteration of the `for` loop in `processImages` provably resolves and the loop completes.

## Reviewer should double-check

- The jsDelivr SRI hash (`sha384-XsTfGA62I8LzqS3D7IcgiSOCrJuECWLcg4s1M0AnrkDCcJ8lXX+j+qdg+o6t7KZa`) was supplied by the task as pre-verified; I did not independently re-fetch and re-hash the CDN artifact (no network access in this environment to do so safely) — recommend a one-time manual check against the live URL before shipping.
- `page.jsx`'s `runPersist`-wrapped `replaceSessionResults` call fires on every single incremental per-image completion during a batch (by design, for atomicity per the coordinator's follow-up) — for a 50-sheet batch that's up to 50 sequential whole-session rewrites. IndexedDB cost should be trivial at this scale, but worth a quick perf sanity check on the stated "modest hardware" target if a reviewer has a real device handy.
- `SessionHeader`'s "Phiên bản chấm cũ" badge and `ResultsPage`'s `legacyPhanII` banner both read fields stamped by the concurrently-landed scoring/storage agent's code (`config.schemaVersion`, `ScoreResult.legacyPhanII`) — confirmed against the current `src/lib/indexed-db-sessions.js` and `src/lib/scoring.js`, but re-check if those files change again after this report.
- `ConfigurationPage`'s Phần II scoring field now displays `pointsPerQuestion × 4` and divides by 4 on save — double check this reads naturally for a teacher; I couldn't user-test the copy.

## Unresolved questions

1. Should the tsc error-count regression (897→993, environmental per above) block sign-off, or is the lint+build+manual-trace evidence sufficient given `@types/react` can't be added? I've implemented everything and documented the discrepancy rather than hide it — need a decision on whether this needs a follow-up ticket to add `@types/react` as a dev-only dependency (would make this exact check meaningful).
2. Prev/Next student navigation in the correction flow and full ConfigurationPage subsection memoization (M9) are the two heavier items I left out — worth a follow-up phase if wanted.
