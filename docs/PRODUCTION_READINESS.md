# Production readiness — statuscraft

Tested commit: `9e25951` (audit/production-readiness; this file was added in
the following docs-only commit). Date: 2026-10-22.

## Scope and architecture

statuscraft runs HTTP synthetic checks, appends every observation to a JSONL
log, and generates a static status page from that log with a pure function
(`buildSiteData`). Incidents are derived from runs of non-`up` results; an
optional overlay adds titles/postmortems to detected incidents only. The CLI
has `init`, `check`, `generate`, `serve` (local preview) and `status`.

## Platforms and prerequisites

- Node >= 18.18 (`engines`), npm. Verified locally on macOS 27 (Apple M5),
  Node 24.19.0, npm 11.17.0.
- Default-branch CI runs Ubuntu/Windows/macOS on Node 20 plus Ubuntu Node 18.
  Windows and Node 18/20 were not run locally for this audit.
- `check` needs outbound network access to the configured URLs.

## Clean-clone verification

Fresh clone of the audit branch, README commands literally:

| Command                                               | Exit | Result                                                                                       |
| ----------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------- |
| `npm install`                                         | 0    |                                                                                              |
| `npm run build`                                       | 0    |                                                                                              |
| `node dist/cli.js init`                               | 0    | wrote `statuscraft.config.json`                                                              |
| `node dist/cli.js check --once`                       | 0    | Marketing site UP, Public API DOWN (`example.com/api/health` is 404, as the README now says) |
| `node dist/cli.js generate`                           | 0    | overall `down`, 1 incident                                                                   |
| `node dist/cli.js serve` + GET `/`                    | —    | 200 on `127.0.0.1:4321`; stopped afterwards                                                  |
| `npm test`                                            | 0    | 144 passed                                                                                   |
| `npm run coverage`, `lint`, `typecheck`, `demo:build` | 0    |                                                                                              |

## Commands and results (working clone, same steps as CI)

| Check                          | Command                                                                           | Before audit                                                                  | After audit                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Install                        | `npm ci`                                                                          | 0                                                                             | 0                                                                                                                         |
| Typecheck                      | `npm run typecheck`                                                               | 0                                                                             | 0                                                                                                                         |
| Lint                           | `npm run lint`                                                                    | 0                                                                             | 0                                                                                                                         |
| Tests + coverage               | `npm run coverage`                                                                | 0 — 14 files, 127 passed                                                      | 0 — 15 files, 144 passed, 0 failed, 0 skipped; statements 99.08%, branches 96.16%                                         |
| Build                          | `npm run build`                                                                   | 0                                                                             | 0                                                                                                                         |
| Demo build                     | `npm run demo:build`                                                              | 0, deterministic                                                              | 0, deterministic (only `data.json` gains `"stale": false`)                                                                |
| Format                         | `npm run format`                                                                  | 0                                                                             | 0                                                                                                                         |
| README quickstart from a clone | `npx statuscraft init`                                                            | fails: `sh: statuscraft: command not found`                                   | replaced by `node dist/cli.js ...`, passes                                                                                |
| Browser render                 | `serve` the demo + headless Chromium; and a generated page with one stale service | —                                                                             | renders, no console errors, no other-origin requests; stale page shows "Status unknown" banner and "No recent data" badge |
| Runtime dependency audit       | `npm audit --omit=dev`                                                            | 0                                                                             | 0                                                                                                                         |
| Full audit                     | `npm audit`                                                                       | dev-only: critical/high in vitest 2, vite, esbuild, typescript-eslint 7 chain | brace-expansion and source-map-js fixed; the rest need major upgrades (vitest 5, typescript-eslint 8) and are not done    |

## CI status

Default branch: success (latest `main` run). Audit branch: pending until pushed.

## Bugs found and fixed

Reproduced against the original build with `buildSiteData` + `renderPage`;
each case below rendered "All systems operational" before the fix.

1. **Green on stale data.** Results 20 days old still showed `up`. Fix:
   `staleAfterMinutes` (default 3 x `intervalMinutes`); stale services are
   `unknown` with `stale: true`, labelled "No recent data".
2. **Green with a service that never reported.** `overallStatus` returned
   `up` for mixed up/unknown. Fix: any unknown makes the page unknown, with a
   banner that says some systems have no recent results. (The existing test
   that asserted the old behaviour was changed, with a comment explaining why.)
3. **Green from a future-dated row.** A `2099` `up` row overrode a current
   `down`. Fix: rows more than 5 minutes in the future are not used as current;
   ordering uses parsed instants instead of string comparison.
4. **Green from a malformed row.** A row with `"status": "ok"` was treated as
   current and the page rolled up to `up`. Fix: `isValidResultRow` validation in
   `ResultStore.readAllWithReport`; invalid rows are skipped and counted.
5. **Unescaped status/severity in HTML.** Escaped now (defence in depth; an
   overlay `severity` was injected verbatim).
6. **`formatTimestamp` threw on an invalid date**, crashing `generate` when an
   overlay update timestamp was malformed. Returns `invalid date` now.
7. **`serve` path containment** used `startsWith(root)`, so
   `/../dist-site-private/...` was served. Fixed with a separator-aware check;
   `serve` now binds `127.0.0.1` instead of all interfaces.
8. **README quickstart did not work from a clone** (`npx statuscraft` cannot
   find the unlinked bin; the npm name belongs to an unrelated package).

Regression tests: `test/honesty.test.ts` (21 tests) covers 1–7.

## Security review

- Secret scan of tree and full history: no credentials. History contains the
  owner's email address in `package.json` `author` (initial commit); removed
  from HEAD, not rewritten. No rotation needed (not a secret).
- XSS: all config/log/overlay strings are escaped; regression test covers
  status, severity, title, postmortem and update text.
- Path traversal in `serve`: fixed (see above). ReDoS: `bodyMatches` patterns
  come from the operator's own config and run against response bodies; not
  hardened (documented limitation).
- CI token now `contents: read`. Actions are pinned to tags, not SHAs
  (unchanged; not broken).

## Known limitations and risks

- Staleness is measured at generation time. A published static page does not
  age by itself: if `generate` stops running, the last generated page stays
  up. Publish with a cache lifetime or regenerate on a schedule.
- `bodyMatches` regexes from config are not time-bounded.
- The checker runs from one vantage point; it cannot distinguish a network
  problem near the checker from a real outage.
- Remaining dev-only advisories need vitest 5 and typescript-eslint 8.

## Acceptance checklist

| #   | Item                                     | Expected                                                       | Command / test                                  | Result | Actual                            | Reference                          |
| --- | ---------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------- | ------ | --------------------------------- | ---------------------------------- |
| 1   | Missing data                             | Service with no results is never green; page not "operational" | `honesty.test.ts` "never green on missing data" | pass   | unknown + "Status unknown" banner | `aggregate.ts`, `renderPage.ts`    |
| 2   | Stale data                               | Newest result older than limit → unknown/"No recent data"      | "never green on stale data" + CLI run           | pass   |                                   | `aggregate.ts`, `buildSiteData.ts` |
| 3   | Future / mis-ordered rows                | Cannot override current status                                 | "future-dated or out-of-order rows"             | pass   |                                   | `aggregate.ts`                     |
| 4   | Malformed rows                           | Skipped and counted, never set status                          | "result store rejects rows" + CLI warning       | pass   | 7 of 8 rows skipped               | `resultStore.ts`                   |
| 5   | Degraded vs down                         | Only latency produces degraded                                 | `statusEngine.test.ts`                          | pass   |                                   | `statusEngine.ts`                  |
| 6   | Incidents derived, overlay cannot invent | Unknown overlay ids ignored                                    | `overlay.test.ts`, `detector.test.ts`           | pass   |                                   | `incidents/`                       |
| 7   | Deterministic output                     | Same inputs → same page                                        | `npm run demo:build` twice, no diff             | pass   |                                   | `buildSiteData.ts`                 |
| 8   | No markup injection                      | Escaped output                                                 | "no markup injection"                           | pass   |                                   | `renderPage.ts`, `escape.ts`       |
| 9   | `serve` containment                      | No reads outside root, loopback bind                           | "serve stays inside" (raw HTTP)                 | pass   | 403                               | `serve.ts`                         |
| 10  | Quickstart from a clone                  | README steps work                                              | clean clone                                     | pass   | see above                         | `README.md`                        |

## Further testing needs

Audit-branch CI (Windows, Node 18/20). Checking real endpoints only needs
network access; no credentials or services are required.

## Classification proposal

**READY FOR DOCUMENTED SCOPE** (proposal; pending audit-branch CI and the
lead's independent verification).
