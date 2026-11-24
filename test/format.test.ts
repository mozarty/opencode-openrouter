import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { bar, money, percent, severity, shortenId } from "../src/format.ts"

describe("money", () => {
  it("renders a placeholder for missing values", () => {
    assert.equal(money(null), "-")
  })

  it("renders whole dollars consistently", () => {
    assert.equal(money(0), "$0.00")
    assert.equal(money(12.5), "$12.50")
    assert.equal(money(1234.5), "$1,234.50")
  })

  it("keeps precision for sub-cent spend", () => {
    assert.equal(money(0.004), "$0.0040")
    assert.equal(money(-0.004), "$-0.0040")
  })

  it("keeps negative balances legible", () => {
    assert.equal(money(-3.25), "-$3.25")
  })
})

describe("percent", () => {
  it("renders a placeholder for missing values", () => {
    assert.equal(percent(null), "-")
  })

  it("rounds to whole percent", () => {
    assert.equal(percent(0.5), "50%")
    assert.equal(percent(0.333), "33%")
  })

  it("reports overspending instead of clamping at 100%", () => {
    assert.equal(percent(1.5), "150%")
  })

  it("floors negative percentages at zero", () => {
    assert.equal(percent(-0.2), "0%")
  })
})

describe("bar", () => {
  it("fills the requested width proportionally", () => {
    assert.equal(bar(0.5, 10), "█████░░░░░")
    assert.equal(bar(0, 4), "░░░░")
    assert.equal(bar(1, 4), "████")
  })

  it("clamps overspend to a full bar", () => {
    assert.equal(bar(3, 4), "████")
  })

  it("returns nothing for unknown percentages", () => {
    assert.equal(bar(null, 10), "")
  })
})

describe("severity", () => {
  it("stays normal below 70%", () => {
    assert.equal(severity(null), "normal")
    assert.equal(severity(0.69), "normal")
  })

  it("warns from 70% and is critical from 90%", () => {
    assert.equal(severity(0.7), "warning")
    assert.equal(severity(0.89), "warning")
    assert.equal(severity(0.9), "danger")
    assert.equal(severity(1.4), "danger")
  })
})

describe("shortenId", () => {
  it("truncates workspace ids", () => {
    assert.equal(shortenId("0445f0d2-3ce6-461e-8573-91a27bcb48d2"), "0445f0d2")
    assert.equal(shortenId(null), "unknown")
  })
})
