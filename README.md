# statuscraft

**A status page generator that refuses to lie.**

Every status you see on a statuscraft page — the green banner, the amber
"degraded" badge, the incident timeline — is computed from rows in an
append-only result log, at the moment the page is generated. There is no
admin panel with a dropdown that lets you type "Operational" over an outage.
If you want the page to say something, a synthetic check has to actually
observe it.

<p align="center">
  <img src="docs/screenshots/dark.png" width="49%" alt="statuscraft status page, dark theme">
  <img src="docs/screenshots/light.png" width="49%" alt="statuscraft status page, light theme">
</p>

The screenshots above are the real output of `npm run demo:build` — a
seeded, deterministic fixture checked into [`examples/demo/`](examples/demo).
Open `examples/demo/site/index.html` in a browser to click through it
yourself, or run `npm run demo:build && npx statuscraft serve -d
examples/demo/site`.

## Why this exists

Most "status page" tools are one of two things: a hosted SaaS where an
engineer clicks a big green button to declare "all systems operational" (and
sometimes forgets, or fudges it, during an actual incident), or a static
template where the HTML is hand-edited on deploy. Neither one is checking
anything. statuscraft is built the other way around:

1. A **checker** actually calls your endpoints on a schedule and evaluates
   assertions against the real response — status code, latency, body
   content, JSON fields, headers.
2. Every observation — pass or fail — is **appended, never edited**, to a
   plain JSONL file. That file _is_ the audit trail: `git diff` it, ship it
   to cold storage, replay it through the generator again and get
   byte-identical output.
3. **Incidents are derived, not declared.** A run of consecutive
   degraded/down observations for a check _is_ an incident. You can attach a
   postmortem and a nicer title afterward, but you cannot invent one that the
   checks didn't produce.
4. The **generator** is a pure function from `(config, all results, incident
overlay)` to the page. Nothing about "current status" is stored anywhere
   except as a consequence of the check history.

## What's here

| Piece           | Where            | What it does                                                                                      |
| --------------- | ---------------- | ------------------------------------------------------------------------------------------------- |
| Checker         | `src/checker/`   | Runs HTTP checks with a timeout, evaluates assertions, and derives `up` / `degraded` / `down`     |
| Result store    | `src/store/`     | Append-only JSONL log + day-bucketed uptime aggregation                                           |
| Incident engine | `src/incidents/` | Detects incidents from consecutive bad runs; merges an optional human-authored postmortem overlay |
| Generator       | `src/generator/` | Turns the above into a static `index.html` + `style.css` + `theme.js`, dark/light aware           |
| CLI             | `src/cli.ts`     | `init`, `check`, `generate`, `serve`, `status`                                                    |

## Quickstart

```bash
npm install
npx statuscraft init                       # writes statuscraft.config.json
npx statuscraft check --once               # runs every configured check once
npx statuscraft generate                   # builds dist-site/index.html
npx statuscraft serve                      # preview it at http://localhost:4321
```

Run checks on a loop instead of once, then regenerate on a cron:

```bash
npx statuscraft check                      # runs forever on `intervalMinutes`
# ...separately, whenever you want to publish...
npx statuscraft generate
```

### Configuring checks

`statuscraft.config.json`:

```json
{
  "site": { "name": "Acme", "description": "Live status for Acme's public APIs." },
  "intervalMinutes": 5,
  "uptimeWindowDays": 90,
  "checks": [
    {
      "id": "public-api",
      "name": "Public API",
      "group": "API",
      "url": "https://example.com/api/health",
      "assertions": [
        { "kind": "status", "expected": 200 },
        { "kind": "maxLatencyMs", "degradedAboveMs": 400, "downAboveMs": 3000 },
        { "kind": "bodyContains", "value": "ok" }
      ]
    }
  ]
}
```

Assertion kinds: `status` (exact code or `[min, max]` range), `maxLatencyMs`
(separate degraded/down thresholds — this is the _only_ thing that can
produce `degraded`; every other assertion is pass/fail), `bodyContains`,
`bodyNotContains`, `bodyMatches` (regex), `jsonPath` (dot-path equality
against a parsed JSON body), and `headerEquals`.

**How degraded differs from down:** a non-latency assertion failing (wrong
status code, missing text, a network error) is always `down`. Latency past
`degradedAboveMs` but under `downAboveMs`, with everything else passing, is
`degraded`. This is the one rule the whole "not just up/down" story rests on
— see `src/checker/statusEngine.ts`.

### Writing a postmortem

Incidents need no configuration — they fall out of the check history
automatically. To add a title and postmortem, look up the incident's id from
`dist-site/data.json` (or the CLI's `generate` output) and add it to
`data/incidents.json`:

```json
{
  "incidents": [
    {
      "id": "public-api-2024-04-18T12:00:00.000Z",
      "title": "Checkout API outage: database failover",
      "severity": "critical",
      "postmortem": "Summary: ...\n\nRoot cause: ...\n\nRemediation: ..."
    }
  ]
}
```

The `id` has to match a real detected incident or the overlay entry is
silently ignored — see `src/incidents/overlay.ts`.

## Architecture

```
statuscraft.config.json ──┐
                           ▼
                    ┌──────────────┐        data/results.jsonl
  every N minutes → │   checker    │ ───append-only───▶ (the audit trail)
                    └──────────────┘                          │
                                                                │ read in full
data/incidents.json ───────────────────────────────┐           ▼
   (optional, human)                                ▼   ┌──────────────┐
                                              ┌─────────▶│ buildSiteData│
                                              │          │  (pure fn)   │
                                              │          └──────┬───────┘
                                    incident overlay             │
                                       merge only,                ▼
                                     never invents          GeneratedSiteData
                                                                   │
                                                                   ▼
                                                          ┌────────────────┐
                                                          │  renderPage +  │
                                                          │  writeSite     │
                                                          └───────┬────────┘
                                                                  ▼
                                                     dist-site/index.html
                                                     dist-site/assets/*.css,*.js
                                                     dist-site/data.json (audit snapshot)
```

`buildSiteData` (`src/generator/buildSiteData.ts`) is the one function you
need to understand: `(config, results: CheckResult[], overlay) ->
GeneratedSiteData`. It is pure and synchronous, which is what makes the
generator's output reproducible and easy to unit test — every test in
`test/buildSiteData.test.ts` and `test/renderPage.test.ts` calls it directly
with hand-built result arrays instead of running real HTTP checks.

## Development

```bash
npm test           # vitest — 127 tests
npm run coverage   # ~99% statement coverage
npm run lint       # eslint --max-warnings=0
npm run typecheck  # tsc --noEmit, strict
npm run build      # emit dist/
npm run demo:build # regenerate examples/demo/ from a seeded fixture
```

CI (`.github/workflows/ci.yml`) runs typecheck, lint, tests with coverage,
build, and a full demo-site build on Ubuntu, Windows, and macOS.

## License

MIT © 2026 Prabesh Sharma — see [LICENSE](LICENSE).
