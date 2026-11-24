// Maps theme tokens to the widget palette. Colors are converted to hex strings
// because the span reconciler mishandles RGBA class instances on update, and
// OpenTUI's own rgbToHex does the same conversion internally.
import type { Severity } from "./format"

export type Rgba = { toInts(): [number, number, number, number] }

export type PaletteTokens = {
  readonly accent: Rgba
  readonly muted: Rgba
  readonly base: Rgba
  readonly info: Rgba
  readonly secondary: Rgba
  readonly warning: Rgba
  readonly danger: Rgba
  readonly success: Rgba
}

export type Palette = {
  accent: string
  label: string
  value: string
  today: string
  average: string
  forecast: string
  warning: string
  danger: string
  success: string
  divider: string
}

function channel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

export function toHex(color: Rgba, alphaOverride?: number): string {
  const [r, g, b, a] = color.toInts()
  const channels = [channel(r), channel(g), channel(b)]
  const alpha = alphaOverride == null ? channel(a) : channel(alphaOverride * 255)
  if (alpha !== 255) channels.push(alpha)
  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`
}

export function withAlpha(hex: string, alpha: number): string {
  const body = hex.replace("#", "")
  if (body.length < 6 || !/^[0-9a-fA-F]+$/.test(body)) return hex
  const byte = channel(alpha * 255)
    .toString(16)
    .padStart(2, "0")
  return `#${body.slice(0, 6)}${byte}`
}

// Each metric gets its own hue from the theme instead of one flat text color:
// accent chrome, blue "today", purple "average", green "forecast", and the
// theme's warning/danger hues for budget pressure.
export function buildPalette(tokens: PaletteTokens, options: { accentOverride?: string | null } = {}): Palette {
  const accent = options.accentOverride ?? toHex(tokens.accent)
  return {
    accent,
    label: toHex(tokens.muted),
    value: toHex(tokens.base),
    today: toHex(tokens.info),
    average: toHex(tokens.secondary),
    forecast: toHex(tokens.success),
    warning: toHex(tokens.warning),
    danger: toHex(tokens.danger),
    success: toHex(tokens.success),
    divider: withAlpha(accent, 0.35),
  }
}

// Severity overrides the metric's own color, so "normal" keeps it colorful
// while pressure states stay unmistakable.
export function severityColor(palette: Palette, level: Severity, normal: string): string {
  if (level === "danger") return palette.danger
  if (level === "warning") return palette.warning
  return normal
}
