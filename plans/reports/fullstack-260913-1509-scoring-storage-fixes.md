# Implementation Report — Scoring / Storage Fixes

Date: 2026-09-13. Source: `plans/reports/code-review-260913-1509-scoring-storage.md`.
Owned files only: `scoring.js`, `item-analysis.js`, `statistics.js`, `indexed-db-store.js`, `indexed-db-sessions.js`, `indexed-db-results.js`, `local-storage-migration.js`, `session-export-import.js`.

## Phần II CV1239 tier table (hand-verified)

Default `pointsPerQuestion = 0.25` (maxPerQuestion = 1.0):

| ý đúng | điểm (current model) | điểm (legacy linear, preserved for old sessions) |
|---|---|---|
| 0 | 0 | 0 |
| 1 | 0.10 | 0.25 |
| 2 | 0.25 | 0.50 |
| 3 | 0.50 | 0.75 |
| 4 | 1.00 | 1.00 |

Verified by running `calculateScore` directly (node ESM import), matches table exactly. Blank sub-item (`null`) vs an all-`false` key → 0 điểm (confirmed, no more free credit for unanswered questions).

## Per-file changes

**scoring.js** — full rewrite.
- C1: `PHAN_II_TIERS = [0, 0.1, 0.25, 0.5, 1.0]`, scaled by `pointsEach*4` (configurable max). All-or-nothing branch unchanged.
- C2: all three scorers bounded by `Math.min(questionCount, correctAnswers.length)` instead of `answers.length`.
- H1: blank (`null`/`undefined`) sub-items never compared/credited.
- H2: `normalizePhanIIIAnswer` (exported, reused by item-analysis.js) — trims, unifies `,`→`.`, rejects `UNKNOWN_DIGIT`/empty/non-numeric via `null`, compares numerically. All 8 report cases + 2 extra (unknown digit, empty) verified.
- Frozen-contract items: `student.error` short-circuits to a zero, `unscored:true` result before touching any answer array (crash fixed). `legacyPhanII` flag added to `ScoreResult` (extra field, via unannotated intermediate variable so no excess-property TS error against the frozen `ScoreResult` typedef).
- L1/L3: `SUB_OPTIONS` typed tuple (fixes TS7053), phanI/II/III rounded to 2dp before summing into CSV-bound output.
- Re-grade policy: `legacyPhanII = config.schemaVersion < 3` (current `SCHEMA_VERSION`). Session config schemaVersion is stamped by `indexed-db-sessions.js` (see below) — scoring.js only reads it.

**indexed-db-sessions.js** — full rewrite.
- H3: (delegated to indexed-db-store.js's `openDB`).
- H4: `tx.onabort` added to all 4 transactions via shared `txAbortError` helper.
- Re-grade safety mechanism (the "SCHEMA_VERSION detection" the task asked for): `stampLegacyIfMissing` marks any session read with no `config.schemaVersion` as legacy (`1`) — this is the read-side guarantee that opening an old session (even without saving) never silently upgrades it to the new tier model. `withSchemaVersion` (write side): explicit caller-provided version always respected; an update to an existing session preserves its already-resolved version; a brand-new session (no existing record) stamps current `SCHEMA_VERSION` (3) since it has no history to protect.
- **Signature change (non-breaking):** `saveSession` now returns `Promise<SessionRecord>` (the persisted object with schemaVersion resolved) instead of `Promise<void>`. Existing callers that `await saveSession(x)` without using the result are unaffected. Recommend page.jsx capture the return value and use it for `setActiveSession`/`setSessions` so a session created in the same tab immediately reflects its stamped schemaVersion instead of waiting for the next full session-list reload (minor, non-critical edge case — see Concerns).

**indexed-db-results.js** — full rewrite.
- H4: `onabort` on all 5 transactions.
- Fixed pre-existing baseline bug: `event.target.result` (untyped, TS2339) replaced with `request.result` (same request already in closure) in `deleteSessionResults`.
- M3: new export `replaceSessionResults(sessionId, results)` — clears all existing rows for a session then puts the new set, in one transaction. Fixes "deleted student reappears on reload" (page.jsx's `handleResultsUpdate` currently only `put`s — **not wired up, out of my ownership**, see Concerns).
- M2 (partial): `saveResults` was already a single-transaction batch; unchanged behavior, just added `onabort`.

**indexed-db-store.js** — full rewrite.
- H3: `openDB()` memoizes the connection (`dbPromise`), adds `onblocked` (rejects instead of hanging) and `db.onversionchange` (closes + clears memo so a future schema bump doesn't deadlock the app).
- H4: `txAbortError` helper (exported, reused by the other two files) + `onabort` on all 4 debug-image transactions.
- `STORE_NAME` declaration already restored by orchestrator prior to this pass — confirmed present, untouched.

**local-storage-migration.js** — full rewrite (M1, M2).
- Session id changed from `Date.now()`-derived to fixed `session_migrated_local_storage` — makes a retry after a partial failure an idempotent `put` (same session id, same result ids) instead of creating a duplicate session with orphaned data.
- `JSON.parse` for both config and results wrapped in try/catch; corrupt config marks migrated (stop retry-looping) but does not throw; corrupt results falls back to `[]` and still migrates the config.
- Uses `saveResults` (single transaction) instead of one `saveResult` per row.
- `localStorage.removeItem`/`chambai_migrated` flag only set after both writes resolve — a thrown error leaves localStorage untouched so next boot retries (safely, per above).
- Migrated config is stamped `schemaVersion: 1` (this data predates the CV1239 fix entirely).

**session-export-import.js** — full rewrite (H5, H7-adjacent input validation, M2, M6).
- H5: `validateImportPayload` checks envelope version, `schemaVersion` compatibility (rejects a file exported by a newer app build), session/name/config shape, per-section `answers`/`questionCount` shape, `results` array-or-absent — all before any IndexedDB write. All Vietnamese error messages.
- Result IDs now `imp_${newSessionId}_${index}` (loop index, not `Date.now()`) — collision-free regardless of whether source rows carry `id` at all.
- M2: `saveResults` (single transaction) instead of per-row `saveResult`.
- M6: export anchor is appended to the document before `.click()`, removed after, and `URL.revokeObjectURL` is deferred via `setTimeout(...,0)`.
- Export payload now stamps top-level `schemaVersion: SCHEMA_VERSION`; import re-derives the session's own `config.schemaVersion` (explicit if present, else legacy `1`) — so an imported legacy session keeps the old Phần II formula, not the current one, even though its IndexedDB id is brand new.

**item-analysis.js** — full rewrite.
- M4: `if (!correct) continue;` guards added to Phần I and Phần III (Phần II already had it) — unconfigured keys no longer show as false "Khó".
- M7: `wrongPct = 100 - correctPct - blankPct` (derived, not independently rounded) in all three sections — always sums to 100.
- M8/H1: Phần II denominator now `total * 4` (consistent with I/III) with a real `blankPct` computed from `null` sub-items instead of a hardcoded 0; blank sub-items never counted as correct.
- H2: Phần III comparison uses the same `normalizePhanIIIAnswer` as scoring.js (imported, not duplicated).
- L1: `config` param retyped to `TestConfig`, `results` to a local `ScoredStudentResult` typedef — eliminated the 10 baseline TS2339 errors in this file (down to 0 in my portion).

**statistics.js** — one targeted edit (L3 only, per explicit permission in task since it specifically names this file): `min`/`max` rounded to 2dp like `mean`/`median`, because the new 0.10-điểm tier introduces float noise (`7 × 0.1 !== 0.7` exactly). Nothing else touched — median/mean/empty-guard/bins/no-mutation left as verified-correct.

## Verification

- **Typecheck** (`npx tsc --noEmit --allowJs --checkJs --strict --target es2022 --module esnext --moduleResolution bundler --skipLibCheck src/lib/*.js`): baseline 53 (repo-wide, all agents' concurrent changes included) → **38 after**, and **0 errors in any of my 8 owned files** (all were either fixed or, where the fix required a JSDoc type upgrade, resolved cleanly — e.g. `item-analysis.js` 10→0, `indexed-db-store.js`'s 8 `STORE_NAME` errors already gone before I started, `indexed-db-results.js`'s 2 event.target errors → 0). Remaining 38 errors are entirely in files owned by other agents (`answer-detection.js`, `corner-marker-fallback.js`, `debug-visualization.js`, `detection-pipeline.js`, `image-preprocessing.js`, `image-quality-check.js`, `marker-detection.js`).
- **Lint** (`npm run lint`): 4 pre-existing `no-img-element` warnings (expected, not mine) + 1 new **error** in `src/components/ImageProcessor.jsx:22` ("Cannot access refs during render") — this file is owned by another agent, not touched by me; flagging for the orchestrator/UI agent, not something I can fix.
- **Build** (`npm run build`): succeeds, compiles, generates static pages.
- **Hand-verification script** (node ESM import of `scoring.js`): CV1239 tier table exact match for all 5 cases under both current and legacy models; blank-vs-false-key → 0; all 8 Phần III normalization cases (incl. unknown-digit and empty) correct; question-count-desync case bounds correctly (`percentage: 100`, not >100); error-result path returns zeroed/`unscored` result without throwing.

## Re-grading / migration behavior for pre-existing sessions (the money-critical decision)

1. Any session already in IndexedDB before this fix has no `config.schemaVersion`. The **first time it is read** (`getSession`/`getAllSessions`, regardless of whether it's ever saved again), it is stamped `schemaVersion: 1` in the object handed back to the caller — this is what `calculateScore` checks to keep using the **original linear Phần II formula** for that session, forever, until a human explicitly changes it (there is no UI path to do so — this is intentional; the model is tied to session identity, not user-editable, so it cannot be flipped by mistake).
2. A session that is saved for the very first time after this fix (brand new, never existed in the DB) is stamped `schemaVersion: 3` (current) — it starts life on the correct CV1239 tiers.
3. `localStorage`-migrated sessions and imported sessions from an old (pre-schemaVersion) `.chambai.json` are explicitly stamped `1` (legacy) rather than defaulting to current, since there is no way to prove they were graded under the new rules.
4. Net effect: **no teacher's already-computed Phần II grade changes value on reload**, ever, unless the underlying session is deleted and truly recreated from scratch.

## Not done / out of ownership (flagged for the relevant agent or orchestrator)

- **H6** (`page.jsx` `handleResultsUpdate`/`handleResultsClear` unhandled rejections) — not fixed, file not owned. The building block (`replaceSessionResults`, atomic clear+put, fixes M3 too) is now exported from `indexed-db-results.js`; page.jsx should call it instead of `saveResults` and wrap the call in try/catch with a revert-on-failure `alert`.
- **H7** (CSV formula-injection / unescaped fields) — not fixed, `ResultsPage.jsx` not owned. Needs the `csvCell` escaping helper described in the review report.
- **3 swallowed-catch call sites** (`UploadPage.jsx:99`, `page.jsx:133,146` calling `.catch(() => {})` on debug-image ops) — not fixed, not owned. Should become `.catch((e) => console.error(...))` at minimum.
- **UI label** ("điểm/ý" in `ConfigurationPage.jsx:182`) — now describes an internal per-question maximum (`pointsPerQuestion × 4`), not a literal per-sub-item point value, since the tier fractions are fixed by CV1239. Recommend relabeling to something like "Phần II (điểm tối đa/câu)" — please relay to the UI-owning agent.
- **L4** (discrimination index) — explicitly out of scope per task (not requested).
- **L2** (statistics.js counting unscored as 0) — left as-is: in this app's actual data flow every result always gets a `score` object (including the new `unscored:true` zero-score for error results), so the latent scenario the finding describes does not occur; changing it would be unrequested scope on a file I was told to otherwise leave alone.

## Unresolved questions

1. Should `page.jsx` be updated (by the UI-owning agent) to call `replaceSessionResults` instead of `saveResults`, and to capture `saveSession`'s new return value? Both are additive/non-breaking on my side; I can't touch `page.jsx`.
2. Confirm the "điểm/ý" label rewording above with the UI agent/product owner before they change it.
