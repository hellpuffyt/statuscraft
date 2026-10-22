# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- The page no longer shows green from missing or stale data: a service whose
  newest result is older than `staleAfterMinutes` (new, optional; default
  three check intervals) is "No recent data"/unknown, and the banner only
  says "All systems operational" when every service has a fresh `up`.
- Result-log rows with an invalid status, timestamp or check id are skipped
  and counted (warning from `generate`/`status`); rows dated more than five
  minutes in the future never become the current status; results are
  ordered by instant rather than by string.
- Status and severity values are HTML-escaped in the generated page; an
  invalid overlay timestamp no longer crashes `generate`.
- `serve` no longer serves sibling directories that share the root's name
  prefix, and binds to `127.0.0.1` only.
- README quickstart: `npx statuscraft` does not work from a clone (the
  package is not published and its bin is not linked); it now uses
  `npm run build` and `node dist/cli.js`.
- CI workflow token restricted to `contents: read`.

### Added

- `test/honesty.test.ts` regression suite, `SECURITY.md`, `.editorconfig`,
  `docs/PRODUCTION_READINESS.md`.

## [1.0.0] - 2026-09-02

### Added

- HTTP checker with pluggable assertions: status (exact or range), latency
  thresholds (separate degraded/down bounds), body substring/regex, JSON
  path equality, and header equality.
- Append-only JSONL result store (`ResultStore`) as the audit trail — writes
  are append-only; reads tolerate partial/corrupt lines without failing.
- Status derivation engine (`deriveStatus`) that turns a response plus its
  assertion results into `up` / `degraded` / `down`, with degraded reserved
  strictly for the latency-only case.
- Day-bucketed uptime aggregation and per-service summaries, always emitting
  a fixed-size rolling window (gaps render as "unknown", never silently
  as "up").
- Incident detector that derives incidents purely from consecutive
  non-`up` runs per check, with severity heuristics and open/resolved state.
- Optional incident overlay (`incidents.json`) for human-authored titles,
  severity overrides, and postmortems, matched strictly by detected
  incident id — it can enrich an incident, never invent one.
- Static site generator: dark/light theme tokens (OS-aware, with a
  persisted manual toggle), uptime heartbeat bars, degraded/down visual
  states, and an incident timeline with expandable postmortems.
- CLI (`statuscraft`): `init`, `check` (`--once` or daemon loop), `generate`,
  `serve` (local static preview server), and `status`.
- Deterministic demo dataset and generated site under `examples/demo/`.
- 127 tests (vitest) covering assertions, status derivation, the HTTP
  client, the result store, aggregation, incident detection, the overlay,
  config validation, site generation, and an end-to-end CLI run against a
  local HTTP server.
