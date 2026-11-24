import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { usageView, type UsageView } from "../src/view.ts"
import type { Snapshot } from "../src/usage.ts"

const NOW = new Date(Date.UTC(2026, 10, 24)) // day 24 of the month

const spent: Snapshot = {
  daily: 1.2,
  monthly: 24,
  budget: null,
}

// Indexed from the end: the budget block is the tail of the widget.
function rowAt(view: UsageView, index: number) {
  const line = view.lines.at(index)
  if (line?.kind !== "row") throw new Error(`expected a row at ${index}`)
  return line
}

function labels(view: UsageView): string[] {
  return view.lines.flatMap((line) => (line.kind === "row" ? [line.label] : []))
}

describe("usageView", () => {
  it("prints spend rows without a budget block", () => {
    const view = usageView(spent, null, NOW)

    assert.deepEqual(view.lines, [
      { kind: "row", label: "Today", value: "$1.20", tone: "today" },
      { kind: "rule" },
      { kind: "row", label: "Month", value: "$24.00", tone: "value" },
      { kind: "row", label: "Avg/day", value: "$1.00", tone: "average" },
    ])
    assert.equal(view.width, 26)
  })

  it("labels the budget row by its own window", () => {
    const view = usageView({ ...spent, budget: { window: "week", total: 50, spend: 12.5, remaining: 37.5 } }, null, NOW)

    assert.deepEqual(labels(view), ["Today", "Month", "Avg/day", "Remaining", "Week cap", ""])
    assert.deepEqual(rowAt(view, -2), {
      kind: "row",
      label: "Week cap",
      value: "$12.50 / $50.00",
      tone: "value",
    })
    assert.deepEqual(rowAt(view, -1), {
      kind: "row",
      label: "",
      value: `${"█".repeat(3)}${"░".repeat(9)} 25%`,
      tone: "value",
    })
  })

  it("keeps the budget percentage on the budget's own spend", () => {
    const view = usageView(
      { daily: 0.9, monthly: 71.8, budget: { window: "month", total: 200, spend: 77.2, remaining: 122.8 } },
      null,
      NOW,
    )

    // 77.2 of 200 is 39%, not the 36% the key's own monthly spend would give.
    assert.deepEqual(rowAt(view, -2), {
      kind: "row",
      label: "Month cap",
      value: "$77.20 / $200.00",
      tone: "value",
    })
    assert.match(rowAt(view, -1).value, / 39%$/)
  })

  it("warns from 70% and turns red at 90%", () => {
    const warning = usageView(
      { ...spent, budget: { window: "month", total: 100, spend: 75, remaining: 25 } },
      null,
      NOW,
    )
    const danger = usageView({ ...spent, budget: { window: "month", total: 100, spend: 95, remaining: 5 } }, null, NOW)

    assert.equal(rowAt(warning, -2).tone, "warning")
    assert.equal(rowAt(danger, -2).tone, "danger")
    assert.equal(rowAt(warning, -1).tone, "warning")
  })

  it("colours an overspent balance as an error", () => {
    const view = usageView({ ...spent, budget: { window: "month", total: 100, spend: 130, remaining: -30 } }, null, NOW)

    assert.deepEqual(rowAt(view, -3), { kind: "row", label: "Remaining", value: "-$30.00", tone: "danger" })
  })

  it("labels a lifetime cap without a window", () => {
    const view = usageView({ ...spent, budget: { window: null, total: 5000, spend: 1200, remaining: 3800 } }, null, NOW)

    assert.equal(rowAt(view, -2).label, "Cap")
  })

  it("falls back to the configured monthly limit", () => {
    const view = usageView(spent, 100, NOW)

    assert.deepEqual(rowAt(view, -2), {
      kind: "row",
      label: "Month cap",
      value: "$24.00 / $100.00",
      tone: "value",
    })
  })

  it("omits the bar when the spend is unknown", () => {
    const view = usageView({ daily: null, monthly: null, budget: null }, 100, NOW)

    assert.equal(rowAt(view, -1).label, "Month cap")
    assert.equal(rowAt(view, -1).value, "- / $100.00")
  })

  it("widens the rule past the longest row", () => {
    const view = usageView(
      { ...spent, budget: { window: "month", total: 100000, spend: 12345.67, remaining: 87654.33 } },
      null,
      NOW,
    )

    assert.ok(view.width > 26)
    assert.equal(view.width, 12 + "$12,345.67 / $100,000.00".length + 2)
  })
})
