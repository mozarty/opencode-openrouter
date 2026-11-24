import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { buildPalette, contrastRatio, pickVivid, toHex, withAlpha, type PaletteTokens } from "../src/theme-colors.ts"

function rgba(r: number, g: number, b: number, a = 255) {
  return { toInts: (): [number, number, number, number] => [r, g, b, a] }
}

// The ayu-dark hues this plugin was tuned against.
const tokens: PaletteTokens = {
  accent: rgba(0xe6, 0xb4, 0x50),
  label: rgba(0x82, 0x8d, 0x8b),
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
})

describe("withAlpha", () => {
  it("appends an alpha byte", () => {
    assert.equal(withAlpha("#e6b450", 0.35), "#e6b45059")
    assert.equal(withAlpha("#e6b450ff", 1), "#e6b450ff")
  })

  it("leaves values it cannot parse untouched", () => {
    assert.equal(withAlpha("red", 0.5), "red")
  })
})

describe("buildPalette", () => {
  it("maps each metric to its theme token", () => {
    assert.deepEqual(buildPalette(tokens), {
      accent: "#e6b450",
      label: "#828d8b",
      value: "#bfbdb6",
      today: "#39bae6",
      average: "#d2a6ff",
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
})

describe("contrastRatio", () => {
  it("reports a readable spread", () => {
    assert.ok(contrastRatio(rgba(0xe6, 0xb4, 0x50), rgba(0x0b, 0x0e, 0x14)) > 10)
    assert.ok(contrastRatio(rgba(0x0b, 0x0e, 0x14), rgba(0x0b, 0x0e, 0x14)) < 1.1)
  })
})

describe("pickVivid", () => {
  const background = rgba(0x0b, 0x0e, 0x14)

  it("picks the base colour from the current layout (step 400)", () => {
    const picked = pickVivid(
      [
        rgba(0xb6, 0xb1, 0xa9),
        rgba(0x89, 0x7e, 0x6b),
        rgba(0x62, 0x59, 0x48),
        rgba(0xe6, 0xb4, 0x50),
        rgba(0x8d, 0x70, 0x37),
      ],
      background,
    )
    assert.ok(picked)
    assert.equal(toHex(picked), "#e6b450")
  })

  it("picks the same colour from the legacy layout (step 200)", () => {
    const picked = pickVivid(
      [rgba(0xfe, 0xd2, 0x7f), rgba(0xe6, 0xb4, 0x50), rgba(0xc6, 0x99, 0x3d), rgba(0xa7, 0x7f, 0x2a)],
      background,
    )
    assert.ok(picked)
    assert.equal(toHex(picked), "#e6b450")
  })

  it("skips shades that do not read against the background", () => {
    const light = rgba(0xff, 0xff, 0xff)
    // Yellow is the most colourful option but vanishes on white.
    const picked = pickVivid([rgba(0xff, 0xff, 0x00), rgba(0x00, 0x5f, 0x5f)], light)
    assert.ok(picked)
    assert.equal(toHex(picked), "#005f5f")
  })

  it("reports nothing when no candidate qualifies", () => {
    assert.equal(pickVivid([rgba(0x0b, 0x0e, 0x14), undefined], background), null)
  })
})
