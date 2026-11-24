# opencode-openrouter

An [OpenCode](https://opencode.ai) TUI plugin that puts your OpenRouter spend in
the sidebar: today's cost, this month's cost, a monthly budget bar and a
month-end forecast, refreshed while you work.

```
╭─ OpenRouter ─────────────────╮
│ ◆ Hackathon         $12.40   │
│                              │
│  Today      $1.20            │
│  ──────────────────────────  │
│  Avg/day    $0.82            │
│  ──────────────────────────  │
│  Forecast   $24.60           │
│  ──────────────────────────  │
│  Month      $12.40 / $50.00  │
│             ███░░░░░░░░░ 25% │
╰──────────────────────────────╯
```

The bar turns amber at 70% of the budget and red at 90%. When the remaining
balance goes negative it is shown in red as an overrun.

## Requirements

- OpenCode 2.x
- An OpenRouter key known to OpenCode (set up the OpenRouter integration, or
  export `OPENROUTER_API_KEY`)

## Install

This package only ships a TUI part, so it belongs in `cli.json`, not
`opencode.json`:

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
| `managementKey`     | `string`                 | –           | OpenRouter management key, used to resolve workspace names. Prefer the env var for secrets.   |
| `monthlyLimit`      | `number`                 | –           | Monthly USD cap used when the API reports no budget for the key.                              |
| `workspaces`        | `Record<string,string>`  | `{}`        | Local labels for workspace ids, for keys that cannot list workspaces.                         |
| `refreshIntervalMs` | `number`                 | `30000`     | Poll interval, clamped to 10s–1h. Spend is also refreshed after every model turn.             |
| `title`             | `string`                 | `OpenRouter`| Box title.                                                                                    |
| `accent`            | `string`                 | theme       | Hex colour for the frame, title and dividers (`#rgb`, `#rrggbb` or `#rrggbbaa`).              |

### Colours

Each metric takes a different hue from the active theme, so the widget stays
readable and native in every theme instead of relying on hardcoded colours:

| Element        | Theme source                     |
| -------------- | -------------------------------- |
| Frame, `◆`, dividers | `hue.accent` (step 200, 600 on light) |
| Labels         | `text.muted`                     |
| Today          | `text.feedback.info`             |
| Avg/day        | `categorical[0]` (200 / 600 on light) |
| Forecast       | `text.feedback.success`          |
| Month + bar    | `text.base`, overridden by `feedback.warning` at 70% and `feedback.error` at 90% |
| Remaining      | `feedback.success`, `feedback.error` when negative |

Set `accent` when you want the frame to carry its own identity, for example
`"accent": "#ff8c3c"`. Only the frame changes; the metric hues still come from
the theme.

### Environment

| Variable                     | Description                                            |
| ---------------------------- | ------------------------------------------------------ |
| `OPENROUTER_API_KEY`         | Key used for usage requests, overriding the stored one. |
| `OPENROUTER_MANAGEMENT_KEY`  | Same as the `managementKey` option.                     |

## Where the numbers come from

Every value is read from OpenRouter's own API, not estimated locally:

- `GET /api/v1/auth/key` → `usage_daily`, `usage_monthly`, `budgets[]`,
  `effective_budget`, `limit`, `limit_remaining`, `workspace_id`.
- `GET /api/v1/workspaces` (only with a management key) → workspace names.

The monthly budget is chosen in this order: the member-scoped monthly budget,
the workspace default member budget, then the key-level limit. A budget only
counts for the current month when it resets at the next UTC month boundary.
Average daily spend uses elapsed UTC days including today, and the forecast
scales that pace to the length of the month.

Settings show a `-` when the API does not report a field. Free-tier keys often
have no `usage_daily`.

## How the key is resolved

1. `OPENROUTER_API_KEY`.
2. OpenCode's credential store (`credential` table in `opencode.db`, read-only).
3. The legacy `auth.json`.

OpenCode's plugin API exposes connection metadata but never credential secrets,
so the read-only SQLite lookup is the only automatic path. Every failure mode
(missing database, missing driver, locked file, unexpected schema) degrades to
"key not found" instead of breaking the widget.

## Troubleshooting

| Widget shows        | Meaning                                                                    |
| ------------------- | -------------------------------------------------------------------------- |
| `not connected`     | OpenCode has no OpenRouter integration. Connect it, or set the env var.     |
| `needs auth`        | The OpenRouter connection needs to be authorized.                          |
| `key not found`     | The integration exists but no key could be read. Set `OPENROUTER_API_KEY`.  |
| `key rejected`      | OpenRouter returned 401/403 for the key.                                    |
| `unreachable`       | Network or API error. The widget retries on the next poll.                  |
| `· stale`           | The last refresh failed; the numbers shown are the last good ones.          |

## Development

```sh
npm install
npm test          # pure helpers, budget resolution, API parsing
npm run typecheck
```

Node 22.18+ is required for the test runner's TypeScript type stripping.

The plugin is published as TypeScript source; OpenCode transpiles it at load
time, so there is no build step.

## License

MIT
