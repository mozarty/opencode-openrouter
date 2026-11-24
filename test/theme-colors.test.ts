import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { buildPalette, severityColor, toHex, withAlpha, type PaletteTokens } from "../src/theme-colors.ts"

function rgba(r: number, g: number, b: number, a = 255) {
  return { toInts: () => [r, g, b, a] as [number, number, number, number] }
}

// The ayu-dark hues this plugin was tuned against.
const tokens: PaletteTokens = {
  accent: rgba(0xe6, 0xb4, 0x50),
  muted: rgba(0x56, 0x5b, 0x66),
  base: rgba(0xbf, 0xbd, 0xb6),
  info: rgba(0x39, 0xba, 0xe6),
  secondary: rgba(0xd2, 0xa6, 0xff),
  warning: rgba(0xe6, 0xb6, 0x73),
  danger: rgba(0xd9, 0x57, 0x57),
  success: rgba(0x7f, 0xd9, 0x62),
}

describe("toHex", () => {
  it("renders six digits when opaque", () => {
    assert.equal(toHex(rgba(0x59, 0xc2, 0xff)), "#59c2ff")
  })

  it("keeps the source alpha channel", () => {
    assert.equal(toHex(rgba(0x59, 0xc2, 0xff, 128)), "#59c2ff80")
  })

  it("overrides alpha when asked", () => {
    assert.equal(toHex(rgba(0xe6, 0xb4, 0x50), 0.35), "#e6b45059")
  })

  it("clamps out-of-range channels", () => {
    assert.equal(toHex(rgba(300, -4, 255.6)), "#ff00ff")
  })
})

describe("withAlpha", () => {
  it("appends an alpha byte", () => {
    assert.equal(withAlpha("#e6b450", 0.35), "#e6b45059")
    assert.equal(withAlpha("#e6b450ff", 1), "#e6b450ff")
  })

  it("leaves unusable values untouched", () => {
    assert.equal(withAlpha("red", 0.5), "red")
    assert.equal(withAlpha("#abc", 0.5), "#abc")
  })
})

describe("buildPalette", () => {
  it("gives every metric a distinct theme hue", () => {
    assert.deepEqual(buildPalette(tokens), {
      accent: "#e6b450",
      label: "#565b66",
      value: "#bfbdb6",
      today: "#39bae6",
      average: "#d2a6ff",
      forecast: "#7fd962",
      warning: "#e6b673",
      danger: "#d95757",
      success: "#7fd962",
      divider: "#e6b45059",
    })
  })

  it("re-tints only the accent when overridden", () => {
    const palette = buildPalette(tokens, { accentOverride: "#ff8c3c" })
    assert.equal(palette.accent, "#ff8c3c")
    assert.equal(palette.divider, "#ff8c3c59")
    assert.equal(palette.today, "#39bae6")
  })

  it("produces five or more distinct colors", () => {
    const palette = buildPalette(tokens)
    const colors = new Set([palette.accent, palette.today, palette.average, palette.forecast, palette.value])
    assert.equal(colors.size, 5)
  })
})

describe("severityColor", () => {
  const palette = buildPalette(tokens)

  it("keeps the metric color while on budget", () => {
    assert.equal(severityColor(palette, "normal", palette.today), "#39bae6")
  })

  it("overrides with the warning and danger hues", () => {
    assert.equal(severityColor(palette, "warning", palette.today), "#e6b673")
    assert.equal(severityColor(palette, "danger", palette.today), "#d95757")
  })
})
