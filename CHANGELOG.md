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
  `refreshIntervalMs`, `title`.
- Environment variables: `OPENROUTER_API_KEY`, `OPENROUTER_MANAGEMENT_KEY`.
- Tests for budget resolution, pace projection, options parsing and formatting.

### Changed

- Colours come from the active OpenCode theme instead of hardcoded hex values,
  so the widget looks native in every theme.
- Configuration moved from `~/.config/opencode/openrouter-local.json` to
  documented plugin options in `cli.json`, with secrets read from the
  environment.
- Plugin part id is `opencode.openrouter` and the TUI part is exported through
  `@opencode/plugin/tui` using `Plugin.define`.

### Fixed

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
