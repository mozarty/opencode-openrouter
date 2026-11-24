# opencode-openrouter

An [OpenCode](https://opencode.ai) TUI plugin that puts your OpenRouter spend in
the sidebar: today's cost, this month's cost and how much of your budget is
left, refreshed while you work.

```
╭─ OpenRouter ───────────────────╮
│ Today       $1.01              │
│ ────────────────────────────── │
│ Month       $71.90             │
│ Avg/day     $3.00              │
│ ────────────────────────────── │
│ Remaining   $122.72            │
│ Month cap   $77.28 / $200.00   │
│             █████░░░░░░░ 39%   │
╰────────────────────────────────╯
```

`Today`, `Month` and `Avg/day` are always the current key's own spend. The
`Remaining` and cap rows describe the budget OpenRouter enforces (here a
monthly $200 member budget), so the bar always compares the spend the API
counts against the cap it counts it against. The bar turns amber at 70% of the
budget and red at 90%, and `Remaining` turns red when it goes negative.

## Requirements

- OpenCode 2.x
- An OpenRouter key known to OpenCode (set up the OpenRouter integration, or
  export `OPENROUTER_API_KEY`)

OpenCode loads TUI plugins on Bun; Node 22.18+ is only needed to run the test
suite.

## Install

```
opencode plugin add opencode-openrouter
```

Or add it by hand. This package only ships a TUI part, so it belongs in
`cli.json`, not `opencode.json`:

```jsonc
// ~/.config/opencode/cli.json
{
  "plugins": ["opencode-openrouter"],
}
```

Add it to `opencode.json` instead when you move it into a package that also has
a server part.

## Options

Options are passed through the plugin entry:

```jsonc
// ~/.config/opencode/cli.json
{
  "plugins": [
    {
      "package": "opencode-openrouter",
      "options": {
        "monthlyLimit": 50,
        "refreshIntervalMs": 60000,
      },
    },
  ],
}
```

| Option              | Type                     | Default     | Description                                                                                  |
| ------------------- | ------------------------ | ----------- | -------------------------------------------------------------------------------------------- |
| `monthlyLimit`      | `number`                 | –           | Monthly USD cap used only when the API reports no budget for the key.                        |
| `refreshIntervalMs` | `number`                 | `30000`     | Poll interval, clamped to 10s–1h. Spend also refreshes the moment your request finishes, and every 5s while it runs (backing off after failures). |
| `title`             | `string`                 | `OpenRouter`| Box title.                                                                                    |
| `accent`            | `string`                 | theme       | Hex colour for the frame, title and dividers (`#rgb`, `#rrggbb` or `#rrggbbaa`).              |

### Colours

Each metric takes a different hue from the active theme, so the widget stays
readable and native in every theme instead of relying on hardcoded colours:

| Element        | Theme source                     |
| -------------- | -------------------------------- |
| Frame, dividers | most colourful `hue.accent` step that reads against the background |
| Labels         | `text.base`                      |
| Today          | `text.feedback.info`             |
| Avg/day        | the `categorical` hue furthest in colour from the accent, by the same rule |
| Month          | `text.base`                      |
| Cap row + bar  | `text.base`, overridden by `feedback.warning` at 70% and `feedback.error` at 90% |
| Remaining      | `feedback.success`, `feedback.error` when negative |

Hue ramps differ between theme layout generations: the legacy layout puts a
hue's base colour on step 200, the current one on step 400. Rather than pin a
step, the palette takes the most colourful step that still clears a minimum
contrast against the background, so both layouts resolve to the same shade.

Set `accent` when you want the frame to carry its own identity, for example
`"accent": "#ff8c3c"`. Only the frame changes; the metric hues still come from
the theme.

### Environment

| Variable             | Description                                            |
| -------------------- | ------------------------------------------------------ |
| `OPENROUTER_API_KEY` | Key used for usage requests, overriding the stored one. |

## Where the numbers come from

Every value is read from OpenRouter's own API, not estimated locally:

- `GET /api/v1/key` → `usage_daily`, `usage_monthly`, `budgets[]`,
  `effective_budget`, `limit`, `limit_reset`, `limit_remaining`.

The budget is the cap OpenRouter enforcement checks, resolved in the API's own
order:

1. `effective_budget`, the budget that blocks requests first.
2. The tightest (least remaining) current entry in `budgets[]`.
3. The key's own `limit`, using `limit_reset` to know the window.

Each cap carries its reset window, so a weekly budget is labelled `Week cap`
and a lifetime one `Cap`. A budget only counts while its window is still open
(`resets_at` in the future). Windows the plugin cannot label are ignored rather
than shown as monthly. `monthlyLimit` is only a fallback for keys with no API
budget at all.

The spend the API counts against a budget is the spend the bar uses. For
member- and workspace-scoped budgets that is the shared aggregate, not just
this key's, which is why `Month cap` can be higher than `Month`. `Today`,
`Month` and `Avg/day` always use the key's own usage; average daily spend uses
elapsed UTC days including today.

Settings show a `-` when the API does not report a field. Free-tier keys often
have no `usage_daily`.

## How the key is resolved

1. `OPENROUTER_API_KEY`.
2. OpenCode's credential store (`credential` table in `opencode.db`, read-only).
3. The legacy `auth.json`.

OpenCode's plugin API exposes connection metadata but never credential secrets,
so the read-only SQLite lookup is the only automatic path. Only key-shaped
credentials are used: a structured OAuth/session blob is never sent to
OpenRouter as a bearer token. Every failure mode (missing database, missing
driver, locked file, unexpected schema) degrades to "key not found" instead of
breaking the widget.

## Troubleshooting

| Widget shows        | Meaning                                                                    |
| ------------------- | -------------------------------------------------------------------------- |
| `not connected`     | OpenCode has no OpenRouter integration. Connect it, or set the env var.     |
| `needs auth`        | The OpenRouter connection needs to be authorized.                          |
| `checking key`      | OpenCode is still loading integration metadata; this resolves itself.      |
| `key not found`     | The integration exists but no key could be read. Set `OPENROUTER_API_KEY`.  |
| `key rejected`      | OpenRouter returned 401/403 for the key.                                    |
| `unreachable`       | Network or API error. The widget retries on the next poll.                  |
| `· stale`           | The last refresh failed; the numbers shown are the last good ones.          |

The `openrouter.refresh` palette command refreshes immediately and reports the
outcome as a toast.

## Development

```sh
npm install
npm test                 # pure helpers, budget resolution, API parsing, layout
npm run typecheck
npm run check            # Biome: formatting + lint
npm run check:fix        # ... and apply the fixes
bun script/smoke.bun.ts  # the bun:sqlite credential path the TUI uses
```

Formatting is [Biome](https://biomejs.dev) with the repo's style pinned in
`biome.json` (120 columns, no semicolons, double quotes). Node 22.18+ is
required for the test runner's TypeScript type stripping. The plugin itself is
loaded by OpenCode on Bun, so the Bun-only credential path has its own smoke
script and CI job.

The plugin is published as TypeScript source; OpenCode transpiles it at load
time, so there is no build step.

## License

MIT
