// Normalizes plugin options from cli.json `plugins` entries and environment
// variables into a single validated shape.
export type PluginOptions = {
  readonly managementKey: string | null
  readonly monthlyLimit: number | null
  readonly workspaces: Readonly<Record<string, string>>
  readonly refreshIntervalMs: number
  readonly title: string
}

export const MIN_REFRESH_INTERVAL_MS = 10_000
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

function asInterval(value: unknown): number {
  const wanted = asPositiveNumber(value)
  if (wanted == null) return DEFAULT_REFRESH_INTERVAL_MS
  return Math.min(60 * 60_000, Math.max(MIN_REFRESH_INTERVAL_MS, Math.round(wanted)))
}

export function parseOptions(
  raw: Readonly<Record<string, unknown>> | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): PluginOptions {
  const managementKey =
    (typeof raw?.managementKey === "string" && raw.managementKey.trim()) ||
    (typeof env[ENV_MANAGEMENT_KEY] === "string" && env[ENV_MANAGEMENT_KEY]!.trim()) ||
    null

  const title = typeof raw?.title === "string" && raw.title.trim() ? raw.title.trim() : "OpenRouter"

  return {
    managementKey: managementKey || null,
    monthlyLimit: asPositiveNumber(raw?.monthlyLimit),
    workspaces: asStringMap(raw?.workspaces),
    refreshIntervalMs: asInterval(raw?.refreshIntervalMs),
    title,
  }
}
