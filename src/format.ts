// Pure display helpers. Kept free of I/O and theme access so they are cheap to
// test and safe to reuse outside the widget.
export type Severity = "normal" | "warning" | "danger"

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

const usdPrecise = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
})

export function money(value: number | null): string {
  if (value == null) return "-"
  if (value === 0) return "$0.00"
  return Math.abs(value) < 0.01 ? usdPrecise.format(value) : usd.format(value)
}

export function percent(pct: number | null): string {
  if (pct == null) return "-"
  return `${Math.round(pct * 100)}%`
}

export function bar(pct: number | null, width: number): string {
  if (pct == null || width <= 0) return ""
  const filled = Math.max(0, Math.min(width, Math.round(pct * width)))
  return "█".repeat(filled) + "░".repeat(width - filled)
}

// Spend at 70% of a cap is a nudge, 90% is a warning.
export function severity(pct: number | null): Severity {
  if (pct == null || pct < 0.7) return "normal"
  if (pct < 0.9) return "warning"
  return "danger"
}

export function shortenId(id: string | null, length = 8): string {
  if (!id) return "unknown"
  return id.slice(0, length)
}

// API workspace name wins, then a locally configured label, then the raw id.
export function workspaceLabel(
  workspace: string | null,
  name: string | null,
  labels: Readonly<Record<string, string>>,
): string {
  if (name) return name
  const configured = workspace ? labels[workspace] : undefined
  return configured ?? shortenId(workspace)
}
