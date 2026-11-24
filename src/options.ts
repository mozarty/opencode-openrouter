// Normalizes plugin options from cli.json `plugins` entries into a single
// validated shape.
export type PluginOptions = {
  readonly monthlyLimit: number | null
  readonly refreshIntervalMs: number
  readonly title: string
  readonly accent: string | null
}

export const MIN_REFRESH_INTERVAL_MS = 10_000
export const MAX_REFRESH_INTERVAL_MS = 60 * 60_000
export const DEFAULT_REFRESH_INTERVAL_MS = 30_000
// Per-turn refreshes are throttled separately from the poll so heavy agent
// traffic cannot hammer the API. A finished user request bypasses this entirely.
// Spend only moves when an upstream request settles, so a window shorter than
// this buys nothing but duplicate calls.
export const EVENT_THROTTLE_MS = 5_000
// Consecutive failures double the gap up to this cap, so a rate-limited or
// offline API is probed less and less instead of once per throttle window.
export const MAX_BACKOFF_MS = 2 * 60_000

function asPositiveNumber(value: unknown): number | null {
  const num = typeof value === "string" ? Number(value) : value
  return typeof num === "number" && Number.isFinite(num) && num > 0 ? num : null
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

export function parseOptions(raw: Readonly<Record<string, unknown>> | undefined): PluginOptions {
  return {
    monthlyLimit: asPositiveNumber(raw?.monthlyLimit),
    refreshIntervalMs: asInterval(raw?.refreshIntervalMs),
    title: asText(raw?.title) || "OpenRouter",
    accent: asColor(raw?.accent),
  }
}
