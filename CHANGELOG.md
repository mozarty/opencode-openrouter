# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-24

First public release, extracted from a personal OpenCode config.

### Added

- Sidebar widget showing today's OpenRouter spend, monthly spend, average
  daily spend and a month-end forecast.
- Monthly budget bar with usage severity thresholds (70% nudge, 90% warning)
  and an overrun marker when the remaining balance goes negative.
- Budget resolution from the OpenRouter API (`effective_budget`, member-scoped
  `budgets`, then key-level `limit`), falling back to a configured
  `monthlyLimit`.
- Workspace names from the OpenRouter management API, with a local
  `workspaces` label map as a fallback.
- `openrouter.refresh` palette command for an immediate refresh.
- Plugin options: `managementKey`, `monthlyLimit`, `workspaces`,
  `refreshIntervalMs`, `title`, `accent`.
- Environment variables: `OPENROUTER_API_KEY`, `OPENROUTER_MANAGEMENT_KEY`.
- Tests for budget resolution, pace projection, options parsing, palette
  mapping and formatting.

### Changed

- Every metric takes a different hue from the active theme — accent frame,
  info "Today", categorical "Avg/day", success "Forecast" — instead of one flat
  text colour, with warning/danger overriding on budget pressure.
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
