# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `src/view.ts`: the sidebar layout is now a pure function, so labels, the
  budget window and severity colours are covered by tests.
- `script/smoke.bun.ts` plus a Bun CI job, because the TUI reads credentials
  through `bun:sqlite` while the Node suite can only reach `node:sqlite`.
- Biome for formatting and lint (`biome.json`, `npm run check`), wired into CI
  and `prepublishOnly`.
- The `openrouter.refresh` command now reports its outcome as a toast.

### Changed

- The budget is resolved in the API's own enforcement order: `effective_budget`,
  then the tightest current `budgets[]` entry, then the key's own `limit` with
  `limit_reset`. Any window is rendered (`Day cap`, `Week cap`, `Month cap`,
  `Cap` for a lifetime budget) instead of only monthly member budgets.
- The cap row shows the spend the API counts against that budget, so its
  percentage and bar always agree. `Today`, `Month` and `Avg/day` stay scoped to
  the current key.
- `@opencode/plugin` is a peer dependency (plus a dev dependency) instead of a
  runtime dependency, so installing the plugin no longer pulls a second copy of
  the host SDK and `effect`.
- Event-driven refreshes are throttled to 15s (`EVENT_THROTTLE_MS`) so agent
  traffic cannot hammer the key endpoint; the poll interval is unchanged.
- Plugin id is `openrouter.sidebar`, out of the `opencode.*` namespace the host
  keeps for built-ins.
- Local imports use explicit `.ts` extensions so the modules can be imported by
  both Bun and Node's test runner.

### Fixed

- A key with `limit_reset: "weekly"` is no longer displayed as a monthly budget
  with the wrong percentage.
- Weekly, daily and lifetime budgets are no longer dropped, and a budget whose
  window already rolled over is ignored instead of being shown as current.
- Budget freshness is "resets in the future" rather than an exact match against
  the next UTC month boundary.
- A credential row holding the JSON literal `null` is no longer sent as the
  bearer token `null`, and OAuth-shaped `token` fields are never used as API
  keys.
- The sidebar says `checking key` while integration metadata loads instead of
  claiming the key is missing.
- Transient network failures render as a warning (and keep the last good
  snapshot) instead of a hard error.
- The key request uses the documented `/api/v1/key` endpoint instead of the
  undocumented `/api/v1/auth/key` alias.

## [0.1.0] - 2026-11-24

First public release, extracted from a personal OpenCode config.

### Added

- Sidebar widget showing today's OpenRouter spend, monthly spend, average daily
  spend and the remaining budget.
- Monthly budget bar with usage severity thresholds (70% nudge, 90% warning).
- Budget resolution from the OpenRouter API (`effective_budget`, member-scoped
  `budgets`, then key-level `limit`), falling back to a configured
  `monthlyLimit`.
- `openrouter.refresh` palette command for an immediate refresh.
- Plugin options: `monthlyLimit`, `refreshIntervalMs`, `title`, `accent`.
- Environment variable: `OPENROUTER_API_KEY`.
- Tests for budget resolution, average daily spend, options parsing, palette
  mapping and formatting.

### Changed

- The sidebar no longer resolves workspace names: the management key, the
  `/api/v1/workspaces` lookup and its cache are gone, and a `Remaining` row
  shows the balance left instead.
- Every metric takes a different hue from the active theme — accent frame,
  info "Today", categorical "Avg/day" — instead of one flat text colour, with
  warning/danger overriding on budget pressure.
- Labels use the theme's body text colour so the left column stays readable
  instead of fading out at `text.muted`.
- The accent and categorical hues are picked by colourfulness against the
  background instead of a fixed ramp step, so the palette survives OpenCode
  changing its theme layout generation.
- Configuration moved from `~/.config/opencode/openrouter-local.json` to
  documented plugin options in `cli.json`, with secrets read from the
  environment.
- Plugin part id is `opencode.openrouter` and the TUI part is exported through
  `@opencode/plugin/tui` using `Plugin.define`.

### Fixed

- An OAuth-shaped credential blob is no longer sent to OpenRouter as a bearer
  token; only key-shaped secrets are read from the credential store.
- Sub-cent negative balances render as `-$0.0040` instead of `$-0.0040`.
- The widget distinguishes "not configured", "needs auth", "key not found",
  "key rejected" and "unreachable" instead of showing a single `unavailable`.
- A failed refresh keeps the last good snapshot visible and marks it stale
  instead of blanking the widget.
- Requests abort after 10 seconds and on plugin disposal, so a hung request
  can no longer wedge the poll loop.
- Workspace-name caching is keyed by management key and only caches successful
  listings, so a rejected key is retried instead of remembered for 10 minutes.
- Percentages above 100% are displayed as an overrun instead of being clamped.
- API responses are parsed defensively: numeric strings are accepted and
  malformed payloads report `unavailable` instead of throwing.
