import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  DEFAULT_REFRESH_INTERVAL_MS,
  MAX_REFRESH_INTERVAL_MS,
  MIN_REFRESH_INTERVAL_MS,
  parseOptions,
} from "../src/options.ts"

describe("parseOptions", () => {
  it("applies defaults when nothing is configured", () => {
    const options = parseOptions(undefined, {})
    assert.equal(options.managementKey, null)
    assert.equal(options.monthlyLimit, null)
    assert.deepEqual(options.workspaces, {})
    assert.equal(options.refreshIntervalMs, DEFAULT_REFRESH_INTERVAL_MS)
    assert.equal(options.title, "OpenRouter")
    assert.equal(options.accent, null)
  })

  it("prefers the configured management key over the environment", () => {
    const options = parseOptions({ managementKey: "sk-or-managed" }, { OPENROUTER_MANAGEMENT_KEY: "from-env" })
    assert.equal(options.managementKey, "sk-or-managed")
  })

  it("falls back to the environment for the management key", () => {
    assert.equal(parseOptions(undefined, { OPENROUTER_MANAGEMENT_KEY: "from-env" }).managementKey, "from-env")
  })

  it("ignores a blank management key", () => {
    assert.equal(parseOptions({ managementKey: "   " }, {}).managementKey, null)
  })

  it("trims a custom title", () => {
    assert.equal(parseOptions({ title: "  Spend  " }, {}).title, "Spend")
  })

  it("accepts numeric strings for monthlyLimit", () => {
    assert.equal(parseOptions({ monthlyLimit: "25" }, {}).monthlyLimit, 25)
  })

  it("rejects non-positive or non-numeric limits", () => {
    assert.equal(parseOptions({ monthlyLimit: 0 }, {}).monthlyLimit, null)
    assert.equal(parseOptions({ monthlyLimit: -5 }, {}).monthlyLimit, null)
    assert.equal(parseOptions({ monthlyLimit: "lots" }, {}).monthlyLimit, null)
  })

  it("clamps the refresh interval", () => {
    assert.equal(parseOptions({ refreshIntervalMs: 1 }, {}).refreshIntervalMs, MIN_REFRESH_INTERVAL_MS)
    assert.equal(parseOptions({ refreshIntervalMs: 99_999_999 }, {}).refreshIntervalMs, MAX_REFRESH_INTERVAL_MS)
    assert.equal(parseOptions({ refreshIntervalMs: 45_000 }, {}).refreshIntervalMs, 45_000)
  })

  it("keeps only well-formed workspace labels", () => {
    const options = parseOptions({ workspaces: { ws_a: "Team", ws_b: 3, ws_c: "  " } }, {})
    assert.deepEqual(options.workspaces, { ws_a: "Team" })
  })

  it("ignores a malformed workspaces value", () => {
    assert.deepEqual(parseOptions({ workspaces: ["nope"] }, {}).workspaces, {})
  })

  it("expands shorthand accent colours to six digits", () => {
    assert.equal(parseOptions({ accent: "#abc" }, {}).accent, "#aabbcc")
    assert.equal(parseOptions({ accent: " #abcd " }, {}).accent, "#aabbccdd")
  })

  it("accepts six and eight digit accent colours", () => {
    assert.equal(parseOptions({ accent: "#ff8c3c" }, {}).accent, "#ff8c3c")
    assert.equal(parseOptions({ accent: "#ff8c3c80" }, {}).accent, "#ff8c3c80")
  })

  it("rejects non-hex accent values", () => {
    assert.equal(parseOptions({ accent: "orange" }, {}).accent, null)
    assert.equal(parseOptions({ accent: "ff8c3c" }, {}).accent, null)
  })
})
