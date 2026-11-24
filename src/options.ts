// Normalizes plugin options from cli.json `plugins` entries and environment
// variables into a single validated shape.
export type PluginOptions = {
  readonly managementKey: string | null
  readonly monthlyLimit: number | null
  readonly workspaces: Readonly<Record<string, string>>
  readonly refreshIntervalMs: number
  readonly title: string
  readonly accent: string | null
}

export const MIN_REFRESH_INTERVAL_MS = 10_000
export const MAX_REFRESH_INTERVAL_MS = 60 * 60_000
export const DEFAULT_REFRESH_INTERVAL_MS = 30_000

export const ENV_MANAGEMENT_KEY = "OPENROUTER_MANAGEMENT_KEY"

function asPositiveNumber(value: unknown): number | null {
  const num = typeof value === "string" ? Number(value) : value
  return typeof num === "number" && Number.isFinite(num) && num > 0 ? num : null
}

function asStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, label] of Object.entries(value as Record<string, unknown>)) {
    if (typeof label === "string" && label.trim()) out[key] = label.trim()
  }
  return out
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asInterval(value: unknown): number {
  const wanted = asPositiveNumber(value)
  if (wanted == null) return DEFAULT_REFRESH_INTERVAL_MS
  return Math.min(MAX_REFRESH_INTERVAL_MS, Math.max(MIN_REFRESH_INTERVAL_MS, Math.round(wanted)))
}

// Accepts #rgb, #rgba, #rrggbb and #rrggbbaa so the chrome can be re-tinted
// without abandoning the theme's other hues. Shorthand is expanded so the
// palette only ever sees six or eight digits.
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

function asColor(value: unknown): string | null {
  if (typeof value !== "string") return null
  const color = value.trim()
  if (!HEX_COLOR.test(color)) return null
  const body = color.slice(1)
  return body.length <= 4 ? `#${[...body].map((digit) => digit.repeat(2)).join("")}` : color
}

export function parseOptions(
  raw: Readonly<Record<string, unknown>> | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): PluginOptions {
  const managementKey = asText(raw?.managementKey) || asText(env[ENV_MANAGEMENT_KEY]) || null

  return {
    managementKey,
    monthlyLimit: asPositiveNumber(raw?.monthlyLimit),
    workspaces: asStringMap(raw?.workspaces),
    refreshIntervalMs: asInterval(raw?.refreshIntervalMs),
    title: asText(raw?.title) || "OpenRouter",
    accent: asColor(raw?.accent),
  }
}
