# Contributing to statuscraft

Thanks for considering a contribution. This project has one rule that
overrides all others:

> **The generated page may only ever say what the check history proves.**

Any change that makes it possible for `index.html` to show a status, an
uptime number, or an incident that isn't backed by a row in the result store
will be rejected, no matter how convenient it is for a demo.

## Getting set up

```bash
npm install
npm test              # vitest, 127 tests
npm run lint          # eslint --max-warnings=0
npm run typecheck     # tsc --noEmit
npm run build         # emit dist/
npm run demo:build    # regenerate examples/demo/ from a seeded fixture
```

## Project layout

```
src/checker/     HTTP execution + assertion evaluation + up/degraded/down derivation
src/store/       append-only JSONL result store + day-bucketed aggregation
src/incidents/   incident detection from result runs + the postmortem overlay
src/config/      zod schema + config loader
src/generator/   pure data -> GeneratedSiteData -> static HTML/CSS/JS
src/cli.ts       commander wiring for init/check/generate/serve/status
```

`src/generator/buildSiteData.ts` is the seam: it is a pure function from
`(config, results, overlay)` to `GeneratedSiteData`. If you're adding a new
kind of assertion or a new incident heuristic, this is usually the only
function whose output you need to reason about, and it's the cheapest place
to add a unit test.

## Before opening a PR

- Add tests for new behavior — the project targets meaningful coverage, not
  just green checkmarks. `npm run coverage` prints per-file numbers.
- Run `npm run lint && npm run typecheck && npm test` locally; CI runs the
  same three on Ubuntu, Windows, and macOS.
- If you touch `src/generator/`, run `npm run demo:build` and glance at
  `examples/demo/site/index.html` in a browser — a page that generates
  without errors can still look broken.
- Keep `CHANGELOG.md` updated under an `[Unreleased]` heading.

## Reporting a bug

Please include: your `statuscraft.config.json` (redact URLs if needed), the
relevant lines from `data/results.jsonl`, and what you expected the
generated page to show instead.
