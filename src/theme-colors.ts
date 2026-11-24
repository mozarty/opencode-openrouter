// Maps theme tokens to the widget palette. Colors are converted to hex strings
// because the span reconciler mishandles RGBA class instances on update, and
// OpenTUI's own rgbToHex does the same conversion internally.
export type Rgba = { toInts(): [number, number, number, number] }

export type PaletteTokens = {
  readonly accent: Rgba
  readonly label: Rgba
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
  warning: string
  danger: string
  success: string
  divider: string
}

function channel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function relativeLuminance(color: Rgba): number {
  const [r, g, b] = color.toInts()
  const linear = (value: number) => {
    const scaled = channel(value) / 255
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

export function contrastRatio(a: Rgba, b: Rgba): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b))
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b))
  return (lighter + 0.05) / (darker + 0.05)
}

// Colourfulness as the spread between the strongest and weakest channel.
function vividness(color: Rgba): number {
  const [r, g, b] = color.toInts()
  return Math.max(r, g, b) - Math.min(r, g, b)
}

export const HUE_STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const

// Picks the most colourful candidate that still reads against the background.
// Theme layout generations put the base colour on different steps (the legacy
// layout favours 200, the current one 400), so the step is chosen from the
// colours rather than hardcoded. The contrast floor only rules out shades that
// are effectively invisible against the background.
export function pickVivid(candidates: readonly (Rgba | undefined)[], background: Rgba, minContrast = 2): Rgba | null {
  let picked: Rgba | null = null
  let best = -1

  for (const color of candidates) {
    if (!color || contrastRatio(color, background) < minContrast) continue
    const score = vividness(color)
    if (score > best) {
      best = score
      picked = color
    }
  }

  return picked
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
// accent chrome, info "today", categorical "average", plus the theme's
// success/warning/danger hues for the remaining balance and budget pressure.
export function buildPalette(tokens: PaletteTokens, options: { accentOverride?: string | null } = {}): Palette {
  const accent = options.accentOverride ?? toHex(tokens.accent)
  return {
    accent,
    label: toHex(tokens.label),
    value: toHex(tokens.base),
    today: toHex(tokens.info),
    average: toHex(tokens.secondary),
    warning: toHex(tokens.warning),
    danger: toHex(tokens.danger),
    success: toHex(tokens.success),
    divider: withAlpha(accent, 0.35),
  }
}
