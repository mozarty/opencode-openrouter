import assert from "node:assert/strict"
import { describe, it, type TestContext } from "node:test"

import { averagePerDay, fetchSnapshot, pickBudget, resolveBudget, spendRatio, type Snapshot } from "../src/usage.ts"

type Reply = { status: number; body: unknown }

// Installs a fetch stub for the current test; node:test restores it afterwards.
function mockFetch(t: TestContext, reply: (url: string, init?: RequestInit) => Reply): void {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const { status, body } = reply(String(input), init)
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  })
}

// Instants relative to "now", which is what live budgets report.
const NOW = Date.UTC(2026, 10, 24, 12) // 2026-11-24T12:00Z
const NEXT_DAY = "2026-11-25T00:00:00.000Z"
const NEXT_WEEK = "2026-11-30T00:00:00.000Z"
const NEXT_MONTH = "2026-12-01T00:00:00.000Z"

const emptySnapshot: Snapshot = {
  daily: null,
  monthly: null,
  budget: null,
}

describe("spendRatio", () => {
  it("divides only against a known positive total", () => {
    assert.equal(spendRatio(25, 100), 0.25)
    assert.equal(spendRatio(25, null), null)
    assert.equal(spendRatio(25, 0), null)
    assert.equal(spendRatio(null, 100), null)
  })
})

describe("pickBudget", () => {
  it("prefers the budget enforcement blocks on", () => {
    const budget = pickBudget(
      {
        effective_budget: {
          scope: "member",
          reset_interval: "monthly",
          resets_at: NEXT_MONTH,
          limit_usd: 100,
          spend_usd: 45,
          remaining_usd: 55,
        },
        budgets: [
          {
            scope: "workspace",
            reset_interval: "monthly",
            resets_at: NEXT_MONTH,
            limit_usd: 900,
            spend_usd: 45,
            remaining_usd: 855,
          },
          {
            scope: "member",
            reset_interval: "monthly",
            resets_at: NEXT_MONTH,
            limit_usd: 200,
            spend_usd: 45,
            remaining_usd: 155,
          },
        ],
      },
      NOW,
    )

    assert.deepEqual(budget, { window: "month", total: 100, spend: 45, remaining: 55 })
  })

  it("falls back to the tightest of the listed layers", () => {
    const budget = pickBudget(
      {
        budgets: [
          {
            scope: "workspace",
            reset_interval: "monthly",
            resets_at: NEXT_MONTH,
            limit_usd: 900,
            spend_usd: 45,
            remaining_usd: 855,
          },
          {
            scope: "member",
            reset_interval: "monthly",
            resets_at: NEXT_MONTH,
            limit_usd: 200,
            spend_usd: 45,
            remaining_usd: 155,
          },
          {
            scope: "api_key",
            reset_interval: "monthly",
            resets_at: NEXT_MONTH,
            limit_usd: 60,
            spend_usd: 45,
            remaining_usd: 15,
          },
        ],
      },
      NOW,
    )

    assert.equal(budget?.total, 60)
    assert.equal(budget?.remaining, 15)
  })

  it("labels a weekly budget as a week", () => {
    const budget = pickBudget(
      {
        effective_budget: {
          scope: "member",
          reset_interval: "weekly",
          resets_at: NEXT_WEEK,
          limit_usd: 50,
          spend_usd: 12.5,
          remaining_usd: 37.5,
        },
      },
      NOW,
    )

    assert.deepEqual(budget, { window: "week", total: 50, spend: 12.5, remaining: 37.5 })
  })

  it("drops a budget whose window already rolled over", () => {
    const budget = pickBudget(
      {
        budgets: [
          {
            scope: "member",
            reset_interval: "monthly",
            resets_at: "2020-01-01T00:00:00.000Z",
            limit_usd: 600,
            spend_usd: 500,
            remaining_usd: 100,
          },
        ],
      },
      NOW,
    )

    assert.equal(budget, null)
  })

  it("accepts a lifetime budget that never resets", () => {
    const budget = pickBudget(
      {
        budgets: [
          {
            scope: "workspace",
            reset_interval: null,
            resets_at: null,
            limit_usd: 5000,
            spend_usd: 1200,
            remaining_usd: 3800,
          },
        ],
      },
      NOW,
    )

    assert.deepEqual(budget, { window: null, total: 5000, spend: 1200, remaining: 3800 })
  })

  it("ignores an interval it cannot label", () => {
    const budget = pickBudget(
      {
        budgets: [
          {
            scope: "member",
            reset_interval: "quarterly",
            resets_at: NEXT_MONTH,
            limit_usd: 200,
            spend_usd: 10,
            remaining_usd: 190,
          },
        ],
      },
      NOW,
    )

    assert.equal(budget, null)
  })

  it("reconstructs the missing side of spend and remaining", () => {
    const fromSpend = pickBudget(
      { budgets: [{ scope: "member", reset_interval: "daily", resets_at: NEXT_DAY, limit_usd: 20, spend_usd: 5 }] },
      NOW,
    )
    const fromRemaining = pickBudget(
      {
        budgets: [{ scope: "member", reset_interval: "daily", resets_at: NEXT_DAY, limit_usd: 20, remaining_usd: 15 }],
      },
      NOW,
    )

    assert.deepEqual(fromSpend, { window: "day", total: 20, spend: 5, remaining: 15 })
    assert.deepEqual(fromRemaining, { window: "day", total: 20, spend: 5, remaining: 15 })
  })

  it("falls back to the key's own limit with its reset interval", () => {
    const weekly = pickBudget(
      {
        limit: 500,
        limit_reset: "weekly",
        limit_remaining: 406.5,
        usage_daily: 3,
        usage_weekly: 93.5,
        usage_monthly: 420,
      },
      NOW,
    )
    const monthly = pickBudget(
      { limit: 100, limit_reset: "monthly", limit_remaining: 74.5, usage_weekly: 10, usage_monthly: 25.5 },
      NOW,
    )

    assert.deepEqual(weekly, { window: "week", total: 500, spend: 93.5, remaining: 406.5 })
    assert.deepEqual(monthly, { window: "month", total: 100, spend: 25.5, remaining: 74.5 })
  })

  it("has no budget when the key is uncapped", () => {
    assert.equal(pickBudget({ limit: null, limit_reset: null, limit_remaining: null }, NOW), null)
    assert.equal(pickBudget({}, NOW), null)
  })
})

describe("resolveBudget", () => {
  it("reports the API budget as a ratio of its own spend", () => {
    const limit = resolveBudget(
      { ...emptySnapshot, budget: { window: "month", total: 100, spend: 25, remaining: 75 } },
      50,
    )
    assert.deepEqual(limit, { window: "month", total: 100, spend: 25, remaining: 75, pct: 0.25 })
  })

  it("falls back to the configured monthly limit", () => {
    const limit = resolveBudget({ ...emptySnapshot, monthly: 30 }, 120)
    assert.deepEqual(limit, { window: "month", total: 120, spend: 30, remaining: 90, pct: 0.25 })
  })

  it("reports an overrun as a negative remaining balance", () => {
    const limit = resolveBudget({ ...emptySnapshot, monthly: 130 }, 100)
    assert.deepEqual(limit, { window: "month", total: 100, spend: 130, remaining: -30, pct: 1.3 })
  })

  it("keeps the cap but drops the ratio when spend is unknown", () => {
    assert.deepEqual(resolveBudget(emptySnapshot, 100), {
      window: "month",
      total: 100,
      spend: null,
      remaining: 100,
      pct: null,
    })
  })

  it("reports no budget when neither source has one", () => {
    assert.equal(resolveBudget(emptySnapshot, null), null)
  })
})

describe("averagePerDay", () => {
  it("divides month spend by elapsed UTC days", () => {
    assert.equal(averagePerDay(30, new Date(Date.UTC(2024, 1, 15))), 2)
  })

  it("has no average without spend", () => {
    assert.equal(averagePerDay(null), null)
  })
})

describe("fetchSnapshot", () => {
  for (const status of [401, 403]) {
    it(`reports HTTP ${status} as a rejected key rather than an outage`, async (t) => {
      mockFetch(t, () => ({ status, body: { error: "invalid key" } }))
      assert.deepEqual(await fetchSnapshot("sk-or-bad"), { ok: false, reason: "unauthorized" })
    })
  }

  it("reports a server error as unavailable", async (t) => {
    mockFetch(t, () => ({ status: 503, body: null }))
    assert.deepEqual(await fetchSnapshot("sk-or-any"), { ok: false, reason: "unavailable" })
  })

  it("reports a network failure as unavailable", async (t) => {
    mockFetch(t, () => {
      throw new Error("ECONNRESET")
    })
    assert.deepEqual(await fetchSnapshot("sk-or-any"), { ok: false, reason: "unavailable" })
  })

  it("calls the documented key endpoint with the key", async (t) => {
    let url = ""
    let headers: RequestInit["headers"]
    mockFetch(t, (requested, init) => {
      url = requested
      headers = init?.headers
      return { status: 200, body: { data: { usage_monthly: 1 } } }
    })

    await fetchSnapshot("sk-or-secret")
    const sent = headers as Record<string, string>
    assert.equal(url, "https://openrouter.ai/api/v1/key")
    assert.equal(sent.Authorization, "Bearer sk-or-secret")
    assert.equal(sent.Accept, "application/json")
  })

  it("keeps the spend rows scoped to the key and the budget to the API layer", async (t) => {
    const resetsAt = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)).toISOString()

    mockFetch(t, () => ({
      status: 200,
      body: {
        data: {
          usage_daily: 2,
          usage_monthly: 71.8,
          budgets: [
            {
              scope: "workspace_default_member",
              reset_interval: "monthly",
              resets_at: resetsAt,
              spend_usd: 99,
              limit_usd: 999,
              remaining_usd: 900,
            },
            {
              scope: "member",
              reset_interval: "monthly",
              resets_at: resetsAt,
              spend_usd: 77.2,
              limit_usd: 200,
              remaining_usd: 122.8,
            },
          ],
        },
      },
    }))

    const result = await fetchSnapshot("sk-or-member")
    assert.ok(result.ok, "expected a snapshot")
    assert.deepEqual(result.snapshot, {
      daily: 2,
      monthly: 71.8,
      budget: { window: "month", total: 200, spend: 77.2, remaining: 122.8 },
    })
  })

  it("survives a payload without any budget", async (t) => {
    mockFetch(t, () => ({ status: 200, body: { data: { usage_daily: 1, usage_monthly: 7 } } }))

    const result = await fetchSnapshot("sk-or-any")
    assert.ok(result.ok, "expected a snapshot")
    assert.deepEqual(result.snapshot, { daily: 1, monthly: 7, budget: null })
  })
})
