# chambai — Client-Only Security & Supply-Chain Audit

Date: 2026-09-13 | Branch: main | Scope: READ-ONLY, no source modified
App: Next.js 16.3.5, client-only, no backend/API/auth. Data browser-local (IndexedDB).
`npm audit`: 0 vulnerabilities (verified, 445 deps: 20 prod / 388 dev / 88 opt).

## Threat model applied

Assets: (a) student exam photos + grades in one teacher's browser, (b) integrity of computed
grades, (c) the teacher's machine. No server, no multi-tenancy, no session token, no PII on
the wire. All findings below name a real attacker and a real path under those constraints.

## Summary

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| 1 | HIGH | Third-party OpenCV.js loaded from `docs.opencv.org` with no SRI, no fallback, loaded twice | `layout.jsx:26-29`, `ImageProcessor.jsx:18-26` |
| 2 | MEDIUM | Broken debug-image purge: `STORE_NAME` undefined → `clearDebugImages()` always throws, silently swallowed | `indexed-db-store.js:42,43,57,58,72,73,86,87` |
| 3 | MEDIUM | No CSP / security headers; no exfil control over the CDN script | `next.config.mjs` (empty) |
| 4 | MEDIUM | CSV formula injection reachable via `.chambai.json` import → Excel | `ResultsPage.jsx:57-65` + `session-export-import.js:36-63` |
| 5 | MEDIUM | `allowScripts` field is inert under npm; `unrs-resolver` postinstall runs unconditionally | `package.json:23-25` |
| 6 | MEDIUM | `.chambai.json` import performs no shape validation | `session-export-import.js:36-63` |
| 7 | LOW | Unused dependencies `papaparse`, `opencv-ts` (73 MB) | `package.json:11-12` |
| 8 | LOW | `overrides` floors now redundant; two are unbounded `>=` | `package.json:17-22` |
| 9 | LOW | Exam photos/grades persist unencrypted, indefinitely, on a possibly shared school PC | IndexedDB `chambai` |
| 10 | INFO | No secrets in working tree or git history (31 revs scanned) | — |

---

## 1. HIGH — OpenCV.js loaded from a third-party CDN with no integrity check

**Location**
- `src/app/layout.jsx:26-29` — `<Script src="https://docs.opencv.org/4.9.0/opencv.js" strategy="beforeInteractive" />`
- `src/components/ImageProcessor.jsx:18-26` — a **second**, independent `document.createElement('script')` pointing at the same URL, appended to `document.head`.

**Attacker and path.** TLS protects transit, so a passive network MITM is not the realistic
actor. The realistic actors are: whoever compromises the `docs.opencv.org` origin or its
Cloudflare account/edge config, and anyone who can serve that hostname to the teacher
(corporate/school TLS-intercepting proxy with a trust-store CA — common in institutional
networks). Either substitutes the JS body. No SRI hash means the browser executes whatever
arrives.

**Impact — concretely.** The substituted file runs as first-party script in the app's origin.
It gets:
- Full read of IndexedDB `chambai` — every session, every student ID, every graded answer,
  every score, and any persisted debug image (see finding 2) — via `indexedDB.open('chambai')`.
- Every uploaded exam photo. `ImageProcessor.jsx:40-49` draws each photo into a canvas and
  calls `getImageData()`; a hostile `window.cv` is handed the decoded pixels directly, and can
  also re-read the `File` objects still in React state.
- Silent grade tampering — `window.cv` *is* the detection engine, so it can return whatever
  answers it likes (`detection-pipeline.js:42-51`). Corrupted grades would look legitimate.
- Exfiltration to any host, since there is no CSP (finding 3).

That is complete compromise of assets (a) and (b). It is the single largest risk in this app.

**Two aggravating factors verified this session:**

1. **Loaded twice.** `layout.jsx` loads it for every page via `beforeInteractive`;
   `ImageProcessor.jsx:13-16` then checks `window.cv` and, if absent, injects its own copy.
   Two independent load paths mean any hardening must be applied in both places or it is
   bypassed. The `ImageProcessor` path is also unreachable-by-design dead weight given the
   layout already loads it — but it will fire whenever the layout load fails.
2. **The CDN is currently unreliable.** Direct requests to
   `https://docs.opencv.org/4.9.0/opencv.js` from this machine return **HTTP 403 with a
   Cloudflare "Just a moment..." managed challenge** (`content-type: text/html`,
   `cf-mitigated: challenge`), including with full browser UA and `sec-fetch-dest: script`
   headers. A browser cannot solve an interstitial challenge for a *subresource* request; it
   receives `text/html` under `X-Content-Type-Options: nosniff` and refuses to execute it.
   The challenge response also carries `Cross-Origin-Resource-Policy: same-origin`, which if
   set on the real asset would block cross-origin subresource loading outright. There is **no
   fallback** in either load path, so the app's core function fails with no error surfaced to
   the teacher (`ImageProcessor.jsx:21` only acts on `onload`; there is no `onerror`).

**Remediation — self-host (recommended).** `opencv-ts@1.3.6` is already installed and ships a
complete Emscripten build at `node_modules/opencv-ts/src/opencv.js` (8.6 MB). Serving it
same-origin removes the third-party trust dependency, the SRI/CORS problem, and the Cloudflare
availability problem in one move.

```bash
cp node_modules/opencv-ts/src/opencv.js public/opencv.js
```

Then in `src/app/layout.jsx`:

```jsx
<Script src="/opencv.js" strategy="beforeInteractive" />
```

and delete the entire `useEffect` at `ImageProcessor.jsx:12-26`, replacing the readiness gate
with a poll/`onRuntimeInitialized` hook against the already-loaded global.

> **Version caveat — verify before adopting.** The bundled build reports OpenCV **4.5.5**, not
> the 4.9.0 currently referenced. The APIs this app uses (`cvtColor`, `threshold`, `findContours`,
> `warpPerspective` and friends in `marker-detection.js` / `image-preprocessing.js` /
> `answer-detection.js`) are stable across that range, but re-run a full detection pass on the
> sample sheets in `assets/` and compare scores before shipping. If 4.9.0 is required exactly,
> download it once in a real browser and vendor that file into `public/` instead.

**Remediation — SRI (if the CDN must stay).** Weaker: it converts a silent compromise into a
hard outage, and it does nothing about the Cloudflare challenge. SRI on a cross-origin script
additionally requires `crossorigin="anonymous"` **and** the origin must return a permissive
`Access-Control-Allow-Origin` — unconfirmed for this host, so test before relying on it.

I could not compute the hash: the URL is behind the Cloudflare challenge above and returns a
5 KB HTML page, not the script. Fetch it once in a logged-in browser (DevTools → Network →
right-click → Save), then:

```bash
# PowerShell
$b = [IO.File]::ReadAllBytes("opencv.js")
$h = [Security.Cryptography.SHA384]::Create().ComputeHash($b)
"sha384-" + [Convert]::ToBase64String($h)

# Git Bash / macOS / Linux
echo "sha384-$(openssl dgst -sha384 -binary opencv.js | openssl base64 -A)"
```

```jsx
<Script
  src="https://docs.opencv.org/4.9.0/opencv.js"
  integrity="sha384-<paste>"
  crossOrigin="anonymous"
  strategy="beforeInteractive"
/>
```

Verify the file is genuinely static before pinning — `docs.opencv.org` is a documentation site,
and a docs rebuild that changes the byte content will hard-break the app with an SRI mismatch.
This is the main argument for self-hosting.

---

## 2. MEDIUM — `clearDebugImages()` is permanently broken; stale exam-sheet images cannot be purged

**Location.** `src/lib/indexed-db-store.js` references `STORE_NAME` at lines
42, 43, 57, 58, 72, 73, 86, 87. **The constant is never declared in the file.** Only `DB_NAME`
and `DB_VERSION` exist (lines 4-5). ES modules are strict mode, so every one of
`saveDebugImage`, `getDebugImage`, `deleteDebugImage`, `clearDebugImages` throws
`ReferenceError: STORE_NAME is not defined` on call.

**This is a regression, not an original defect.** Git history confirms it:
- `be8521f` — `src/lib/indexed-db-store.js:5` had `const STORE_NAME = 'debugImages';`
- `e1fc43b` ("feat: add accuracy improvements, session management, analytics...") removed the
  declaration during the v1→v2 schema refactor but left all eight usages in place.

**Impact.** Two distinct consequences:

1. **Stale images are stranded and unpurgeable.** Any teacher who ran the app at or before
   `be8521f` has real annotated answer-sheet images persisted in the `debugImages` object
   store as base64 data URLs (`debug-visualization.js:56` → `canvas.toDataURL()`). The `v1`
   store is still created on upgrade (`indexed-db-store.js:18-20`), so those rows survive.
   Every UI path that is supposed to remove them — "Xóa kết quả" (`page.jsx:133`) and reset-all
   (`page.jsx:146`) — calls `clearDebugImages()`, which now rejects. Both call sites use
   `.catch(() => {})`, so the failure is **silently swallowed and the teacher is told nothing**.
   There is no other code path that clears that store. The app promises a delete it does not
   perform.
2. **New images are not persisted.** `UploadPage.jsx:99` `saveDebugImage(...).catch(() => {})`
   also fails silently, so nothing new accumulates. This is why the bug has gone unnoticed.

The security-relevant part is (1): a broken delete guarantee over student exam images, hidden
by a swallowed error, on a machine that may be shared.

**Smallest correct fix.** Restore the constant:

```js
// src/lib/indexed-db-store.js — after line 5
const STORE_NAME = 'debugImages';
```

Separately, stop swallowing purge failures — at minimum surface the error to the teacher
rather than `.catch(() => {})` at `page.jsx:133` and `page.jsx:146`, so a failed delete is
never reported as a successful one.

---

## 3. MEDIUM — No CSP or security headers

**Location.** `next.config.mjs` is an empty config object. No `headers()`, so the app ships with
no CSP, no `X-Frame-Options`/`frame-ancestors`, no `Referrer-Policy`, no `X-Content-Type-Options`.

**Why it matters here — honest framing.** CSP is not an XSS defense in this app: the required
policy must include `'unsafe-eval'` (see below), which blunts that role. Its real value is
**exfiltration control**. Today, if the CDN script from finding 1 is hostile, it can POST every
exam photo and grade anywhere on the internet. With `connect-src 'self'` plus an `img-src`
restricted to `'self' data: blob:`, a compromised `opencv.js` can still *read* the data but has
no outbound channel — no `fetch`, no XHR, no WebSocket, no image-beacon. That converts total
compromise into local-only tampering. `frame-ancestors 'none'` additionally removes clickjacking
of the destructive "Xóa kết quả" control.

**Verified constraints — what the policy must permit.** Each checked against the actual code
and build this session:

| Requirement | Evidence |
|---|---|
| `'unsafe-eval'` in `script-src` — **mandatory** | The Emscripten/embind runtime calls `new Function(...)` twice (`createNamedFunction`, and the `dynCall` wrapper builder) in `node_modules/opencv-ts/src/opencv.js`. embind invokes these during module init. `'wasm-unsafe-eval'` does **not** cover `new Function`. Omitting `'unsafe-eval'` will break OpenCV. |
| WASM compilation | `new WebAssembly.Module(bytes)` / `WebAssembly.Table` / `instantiateStreaming` present; `wasmBinary` referenced 18×. Covered by `'unsafe-eval'`; `'wasm-unsafe-eval'` listed too so the policy survives a future removal of `'unsafe-eval'`. |
| `'unsafe-inline'` in `script-src` | Next.js App Router emits inline bootstrap/flight scripts. Removing this needs nonce middleware — out of scope for a minimal fix. |
| `'unsafe-inline'` in `style-src` | React `style={{...}}` attributes at `ResultsPage.jsx:184`, `ResultsPage.jsx:218`, `UploadPage.jsx:222`. CSP governs the `style` attribute. |
| `img-src ... data: blob:` | `data:` from `debug-visualization.js:56` `toDataURL()`; `blob:` from `URL.createObjectURL` at `UploadPage.jsx:260` and `ImageProcessor.jsx:36`. |
| `font-src 'self'` only — **no Google Fonts** | `next/font/google` self-hosts at build time. Confirmed: `.woff2` files present under `.next/static/media/`. `globals.css` has no `@import url(http…)`. |
| `connect-src 'self'` | Zero `fetch` / `XMLHttpRequest` / `axios` / `WebSocket` anywhere in `src/`. Verified by grep. |
| No `worker-src` needed | Zero `new Worker` / `importScripts` in `src/` **and** in the OpenCV build. |
| `https://docs.opencv.org` in `script-src` | Required only while finding 1 is unremediated. **Delete this entry once self-hosted.** |

**Ready-to-paste `next.config.mjs`:**

```js
/** @type {import('next').NextConfig} */

// OpenCV.js (Emscripten/embind) requires 'unsafe-eval': the runtime builds functions with
// `new Function(...)` and compiles WebAssembly. CSP here is an exfiltration control, not an
// XSS control -- `connect-src 'self'` and a data:/blob:-only `img-src` leave a compromised
// third-party script no outbound channel.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://docs.opencv.org",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
```

**Two deployment caveats.**
- `headers()` is applied by the Next.js server (`next start`, Vercel). It is **inert** for a
  static export or a plain static host — there, the same headers must be set on the web server
  or host config.
- `next dev` needs `connect-src` to include the HMR websocket. Either keep the header
  production-only, or append `'self' ws:` in development.

Roll out with `Content-Security-Policy-Report-Only` first and confirm a full detection pass on
the `assets/` sample sheets produces zero console violations before switching to enforcing.

---

## 4. MEDIUM — CSV formula injection, reachable only via `.chambai.json` import

**Location.** `src/components/ResultsPage.jsx:57-65`. Fields are joined with `,` and written
raw — no quoting, no escaping, no formula-prefix neutralisation:

```js
...sortedResults.map((r) => [
  r.studentId, r.examCode || '',
  ...
].join(',')),
```

**The OCR path alone is not exploitable — verified.** `studentId` is assembled digit-by-digit
from detected bubble rows: `answer-detection.js:27` `studentId += best.row.toString()`, falling
back to the literal `'UNKNOWN'` (line 31). A photographed answer sheet cannot produce `=`, `+`,
`@`, tab or CR in that field. Scores are numbers. So a teacher grading their own photos cannot
trigger this.

**The import path is exploitable.** `session-export-import.js:53-60` takes `data.results`
straight from an attacker-authored JSON file and spreads each entry
(`await saveResult({ ...r, id: ..., sessionId: ... })`) with **no validation of `studentId` or
`examCode`** (finding 6). Those values then flow to the CSV export verbatim.

**Attacker and path.** A colleague, a "shared marking session" file, or anything mailed to a
teacher: attacker crafts `session.chambai.json` with
`"studentId": "=cmd|'/c calc'!A1"` (or a `+`/`@`/`-` DDE variant). Teacher imports it — the app
presents this as a normal feature — reviews results, clicks "Xuất CSV", opens the file in Excel.
Excel's DDE/formula handling can execute the payload.

**Impact.** Code execution on the teacher's machine — asset (c). Mitigating factors that hold
this at MEDIUM rather than HIGH: it needs social engineering to get the file imported, current
Excel shows a DDE warning prompt, and the `﻿` BOM at `ResultsPage.jsx:67` does not disarm
formulas. A secondary integrity issue exists independently: an imported `studentId` containing
a comma silently corrupts column alignment for the whole row, quietly mis-attributing grades.

**Smallest correct fix — one helper, applied to the text columns:**

```js
// src/components/ResultsPage.jsx
const csvCell = (v) => {
  const s = String(v ?? '');
  // Neutralise spreadsheet formula triggers, then RFC-4180 quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};
```

Then at lines 60-64 wrap the two text fields — `csvCell(r.studentId)`, `csvCell(r.examCode || '')`
— and leave the numeric score columns unquoted.

---

## 5. MEDIUM — `allowScripts` is inert under npm; `unrs-resolver` postinstall runs regardless

**Location.** `package.json:23-25`:

```json
"allowScripts": { "unrs-resolver": true }
```

**`allowScripts` is not an npm field.** It is a pnpm/LavaMoat-era convention. The repo migrated
to npm in `b4113d2` ("build: move from pnpm to npm") and this key came along, but **npm ignores
it entirely**. Verified this session: no project `.npmrc` exists, and `npm config get
ignore-scripts` returns `false`. npm therefore runs **all** lifecycle scripts in the tree, not
just the one named here.

**Attacker and path.** The standard npm install-time supply-chain attack: a compromised release
of any package in the 445-package tree gains arbitrary code execution on the developer's machine
at `npm install` time, with the developer's privileges. `unrs-resolver@1.12.2` does have
`"postinstall": "node postinstall.js"` (it links native resolver binaries) and it runs — but so
would a postinstall on any other package. The field's real harm is that it **documents a
restriction that is not enforced**, so the risk reads as handled when it is not.

**Impact.** Developer-machine compromise at install time. Not a risk to end-user teachers (this
is a build-time concern), so it does not touch assets (a) or (b) — but it does touch (c) for
whoever builds the app.

**Smallest correct fix.** npm has no per-package allowlist equivalent, so pick one:

- **Recommended — enforce, then allow deliberately.** Create `.npmrc` with `ignore-scripts=true`,
  and run `npm rebuild unrs-resolver` explicitly after install (add it to a `postinstall` npm
  script so CI and contributors get it automatically). Verify the ESLint TypeScript resolver
  still works afterwards; if it does not, the native binary is genuinely required and this
  documents exactly why.
- **Minimum — stop lying.** Delete the `allowScripts` key so the file no longer implies an
  enforcement that npm does not provide.

---

## 6. MEDIUM — `.chambai.json` import performs no shape validation

**Location.** `src/lib/session-export-import.js:36-63`.

Validation is limited to `data.version !== 1` (line 39) and `!data.session` (line 40). After
that, attacker-controlled objects are spread wholesale into persisted records:
`{ ...data.session, ... }` (line 43) and `{ ...r, ... }` (line 55). Nothing checks types,
field presence, array-ness, or size.

**Attacker and path.** Anyone who gets a teacher to import a crafted `.chambai.json`.

**Impact — what actually goes wrong (each verified against the consuming code):**
- **Delivers finding 4.** Arbitrary `studentId` / `examCode` strings reach the CSV export.
- **Grade-integrity corruption.** `data.session.config` is stored unchecked and becomes the
  active config on load (`page.jsx:53`), feeding `calculateScore` (`ResultsPage.jsx:20`). A
  crafted `scoring.phanI.pointsPerQuestion` silently changes every score in the session.
- **Crashes / unusable state.** `data.results` is not checked to be an array (line 53
  `for (const r of data.results)` throws on a non-iterable); `r.id` is not checked, so a missing
  id produces the literal record id `undefined_imp_<ts>` (line 57). If `data` itself is `null`,
  line 39 throws `TypeError` before the guard at line 40 runs.
- **Storage exhaustion.** No cap on `data.results` length or on field sizes.

**Prototype pollution: does not apply here — see "considered and dismissed" #1.**

**Smallest correct fix.** Validate and whitelist instead of spreading. Replace the blind spreads
with explicit field copies:

```js
if (!data || typeof data !== 'object') throw new Error('File không hợp lệ');
if (data.version !== 1) throw new Error('Phiên bản file không được hỗ trợ');
if (!data.session || typeof data.session !== 'object') {
  throw new Error('File không hợp lệ: thiếu dữ liệu phiên');
}
const results = Array.isArray(data.results) ? data.results : [];
if (results.length > 5000) throw new Error('File quá lớn');

const str = (v, max = 64) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v) => (Number.isFinite(v) ? v : 0);
```

Build `session` and each result from `str()`/`num()`-guarded fields only — never `...r`. At
minimum, guard `studentId`, `examCode`, `name`, and every numeric under `config.scoring`.

---

## 7. LOW — Unused dependencies

Verified by grep across `src/`: **zero imports** of either.

- **`papaparse@^5.7.0`** (`package.json:12`, 312 KB) — no `import`, no `Papa` reference. CSV
  export at `ResultsPage.jsx:55-73` is hand-rolled. Genuinely dead. **Remove it.**
- **`opencv-ts@^1.3.6`** (`package.json:11`, 73 MB on disk) — no import; OpenCV is obtained
  from the CDN global instead. Dead **as a code dependency**.

**Nuance — do not remove `opencv-ts` yet.** It is the source of the self-hosted `opencv.js`
recommended in finding 1. Sequence it: adopt the self-hosted file first, then either keep
`opencv-ts` as the documented provenance/update path for that vendored asset, or vendor the file
into `public/` and drop the dependency. Removing it before finding 1 is fixed removes the
easiest remediation.

Unused deps are needless install-time attack surface (finding 5) and needless audit surface.

---

## 8. LOW — `overrides` pins are now redundant floors; two are unbounded

**Location.** `package.json:17-22`. Installed versions verified against each pin:

| Override | Installed | Status |
|---|---|---|
| `js-yaml: ">=5.2.2"` | `5.4.2` (dev-only, via the ESLint stack) | Satisfied by latest anyway — redundant |
| `postcss: ">=8.5.18"` | `8.5.26` | Redundant |
| `@babel/core: ">=7.29.6 <8"` | `7.29.7` | Redundant |
| `sharp: ">=0.35.4 <1"` | `0.35.4`, a direct dependency of `next@16.3.5` | Redundant |

**Do these mask a real upstream fix?** No. All four are **floors**, not ceilings pinning to an
old version, so they cannot hold a dependency below a patched release — the failure mode that
makes overrides dangerous. `npm audit` is clean and every resolved version already exceeds its
floor. They are now dead weight rather than a hazard.

**One genuine hygiene issue.** `js-yaml: ">=5.2.2"` and `postcss: ">=8.5.18"` have **no upper
bound**, so a future major (`js-yaml@6`, `postcss@9`) would be silently accepted into the tree
regardless of what the real dependents declare — overrides bypass the dependents' own semver
ranges. The other two correctly bound with `<8` / `<1`.

**Smallest correct fix.** Either delete the whole `overrides` block (nothing needs it now — the
safest and simplest option), or, if you want to keep the floors as documentation of the
Dependabot remediation in `50e135d`, add upper bounds: `">=5.2.2 <6"` and `">=8.5.18 <9"`.
Re-run `npm audit` after either change to confirm resolution is unchanged.

---

## 9. LOW — Data at rest: unencrypted, indefinite, on a possibly shared machine

**Not a vulnerability — a privacy/retention concern, sized to a school context.**

IndexedDB database `chambai` (`indexed-db-store.js:4`) holds, in plaintext: student IDs and
per-question answers and scores (`results` store), session names/dates/configs (`sessions`
store), and base64 answer-sheet images for anyone who used the app at or before `be8521f`
(`debugImages` store — see finding 2). Browser storage is unencrypted at the application layer
and is readable by any other profile-sharing user of that OS account. On a shared staff-room PC
in a school, one teacher's cohort data is visible to the next person at the keyboard. Vietnam's
PDPD (Decree 13/2023) and GDPR-style minimisation both point the same way: student data should
not persist past its purpose.

**What already works.** Per-session deletion is implemented and correct — `page.jsx:78-86`
calls `deleteSession` + `deleteSessionResults`, and `deleteSessionResults`
(`indexed-db-results.js:42-57`) cursors the `sessionId` index and deletes each row. Results
clearing works too. So a teacher *can* purge sessions and grades.

**What does not work.** The debug-image purge is broken (finding 2) and its failure is hidden.
Fixing finding 2 restores the only missing purge path.

**Proportionate suggestions, in order of cost:**
1. Fix finding 2 — this is the actual gap.
2. Surface deletion failures instead of `.catch(() => {})` so "deleted" always means deleted.
3. Add a visible "Xóa toàn bộ dữ liệu" control that calls
   `indexedDB.deleteDatabase('chambai')` plus `localStorage.clear()` — a one-click end-of-term
   or end-of-shift wipe.
4. Document in `README.md` that all data stays in that browser profile and that teachers on
   shared machines should wipe before handing over.

Full client-side encryption would require a passphrase the teacher must manage, and is not
warranted at this sensitivity level.

---

## 10. INFORMATIONAL — No secrets in the repository or its history

Scanned all 31 revisions across all refs.

- No tracked `.env*`, `*.pem`, `*.key`, `id_rsa`, or credential/secret-named files — past or
  present. `.gitignore` correctly covers `.env*` and `*.pem`.
- No API-key, token, password, AWS `AKIA…`, or `BEGIN … PRIVATE KEY` patterns in history.
- `.claude/settings.local.json` **was** committed in four historical revisions
  (`355a3a0`, `a01daea`, `e497376`, `8aa2084`) and later removed and gitignored. Contents
  reviewed in full: Claude Code Bash permission allowlists only (`npm install:*`, `mkdir:*`,
  `grep:*`, …). **No secrets, no personal data.** No history rewrite needed.
- `public/` contains only the five stock Next.js SVGs. `assets/` contains the public MOET
  CV1239 answer-sheet specification PDF and a template PNG — published reference material, no
  student data, nothing sensitive.
- Git author identity (`tiennm99` / the configured email) appears in commit metadata, which is
  normal and expected for a public repo.

---

## Considered and dismissed

Each of these was checked against the code and rejected — reason given.

1. **Prototype pollution via `__proto__` in the imported JSON.** Does not occur. `JSON.parse`
   creates `__proto__` as an ordinary **own** data property, and object spread
   (`{ ...data.session }` at `session-export-import.js:43`, `{ ...r }` at line 55) uses
   `CreateDataPropertyOrThrow`, which defines an own property rather than invoking the
   `Object.prototype.__proto__` setter. No prototype is mutated. IndexedDB's structured-clone
   algorithm likewise ignores prototypes. The import *is* under-validated, but for the reasons
   in finding 6 — not this one.
2. **XSS via `dangerouslySetInnerHTML` / `innerHTML` / `eval` in app code.** Zero occurrences
   across `src/` (grepped `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`,
   `insertAdjacentHTML`, `document.write`, `eval(`, `new Function`). All rendering goes through
   JSX auto-escaping. Imported strings render as text, not markup.
3. **CSV injection from photographed answer sheets.** Not reachable. `studentId` is built only
   from digit characters (`answer-detection.js:27`) or the literal `'UNKNOWN'`. Only the import
   path can introduce a formula prefix — that is finding 4.
4. **`js-yaml@5.4.2` as a dependency-confusion / typosquat substitution.** Investigated
   specifically because 5.x post-dates my knowledge cutoff. It is legitimate: resolved from
   `registry.npmjs.org` with a matching integrity hash, authored by the genuine nodeca/puzrin
   maintainers, and `npm view js-yaml dist-tags` reports `latest: 5.4.2`. No issue.
5. **SQL injection, SSRF, server-side auth bypass, CSRF, IDOR, session fixation, JWT flaws,
   rate limiting, CORS misconfiguration.** No backend, no API routes, no server, no auth, no
   session, no outbound requests. Architecturally impossible.
6. **`window.print()` (`ResultsPage.jsx:83`) leaking data.** Prints locally to the teacher's own
   chosen device; the same teacher already has the data on screen. No trust boundary crossed.
7. **`Math.random()` in the result id (`UploadPage.jsx:53`).** Used only for local row-id
   uniqueness, never as a security token or for unguessability. Non-cryptographic randomness is
   correct here.
8. **`confirm()` before destructive clear (`ResultsPage.jsx:50`).** Adequate for a local,
   single-user tool; no CSRF vector exists to warrant more.
9. **Unrestricted upload file size / count (`UploadPage.jsx:26-34`).** The only party who can
   "attack" is the teacher choosing their own files; worst case is a local tab OOM. Self-inflicted,
   not a security boundary. MIME filtering to JPEG/PNG is present at line 28.
10. **`link.download` filename from `session.name` (`session-export-import.js:24`).** Path
    separators in the `download` attribute are sanitised by every current browser, and the name
    is already whitespace-collapsed. No path traversal.
11. **Next.js 16.3.5 framework CVEs.** `npm audit` reports 0 vulnerabilities across all 445
    packages; no advisory applies to the pinned version.
12. **Missing `Strict-Transport-Security`.** Deliberately omitted from the proposed header block
    — HSTS is a hosting-layer concern and setting it from the app can break local HTTP
    development. Configure it at the host if the app is served over HTTPS on a real domain.

---

## Priority order

1. **Finding 1** — self-host `opencv.js`. Largest real risk, and it simultaneously fixes the
   Cloudflare availability failure. Do this first.
2. **Finding 2** — restore `const STORE_NAME = 'debugImages';`. One line; repairs a broken
   delete guarantee over student images.
3. **Finding 3** — add the headers block (Report-Only first). Contains the damage from any
   future third-party-script compromise.
4. **Findings 4 + 6** — sanitise CSV cells and validate the import. Same attack chain; fix
   together.
5. **Finding 5** — `.npmrc` with `ignore-scripts=true`, or delete the misleading `allowScripts` key.
6. **Findings 7, 8** — drop `papaparse`; bound or delete `overrides`. Sequence `opencv-ts`
   removal after finding 1.
7. **Finding 9** — add a visible "wipe all data" control and a README note.

---

## Unresolved questions

1. **Is OpenCV 4.5.5 (bundled in `opencv-ts`) score-equivalent to 4.9.0 for this pipeline?** I
   could not fetch 4.9.0 to diff, and there are no tests in the repo to compare against. Needs a
   manual detection run over the `assets/` sample sheets before adopting the self-hosted file.
2. **How is the app deployed?** Nothing in `README.md`, `docs/`, or the repo indicates a target.
   This decides whether `next.config.mjs` `headers()` is applied at all (finding 3) — a static
   export would need the headers set on the host instead.
3. **Was the exact `4.9.0` version chosen deliberately?** If a specific API or accuracy
   characteristic of 4.9.0 is required, the self-hosting fix needs that exact file vendored
   rather than the `opencv-ts` build.
4. **Is the Cloudflare 403 on `docs.opencv.org` permanent or transient?** Observed consistently
   from this machine/IP this session across several header profiles. If real browsers are
   currently affected too, finding 1 is an active outage, not just a latent risk — worth testing
   from a teacher's network.
5. **Do any deployed users actually hold rows in the `debugImages` store?** Depends on whether
   the app was used at or before `be8521f`. If yes, finding 2 is live data exposure rather than a
   latent one, and a one-time migration to clear that store should ship with the fix.
6. **Is `unrs-resolver`'s native binary genuinely required** for the ESLint TypeScript resolver
   in this project (which has no TypeScript source left)? If not, `ignore-scripts=true` is
   free.
