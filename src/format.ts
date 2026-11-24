// Pure display helpers. Kept free of I/O and theme access so they are cheap to
// test and safe to reuse outside the widget.
export type Severity = "normal" | "warning" | "danger"

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

export function money(value: number | null): string {
  if (value == null) return "-"
  if (value === 0) return "$0.00"
  if (Math.abs(value) < 0.01) return `$${value.toFixed(4)}`
  return usd.format(value)
}

// Not clamped at 100%: overspending a cap is information worth showing.
export function percent(pct: number | null): string {
  if (pct == null) return "-"
  return `${Math.round(Math.max(0, pct) * 100)}%`
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
