import assert from "node:assert/strict"
import { describe, it, type TestContext } from "node:test"

import {
  averagePerDay,
  fetchSnapshot,
  resolveMonthlyLimit,
  spendRatio,
  type Snapshot,
} from "../src/usage.ts"

type Reply = { status: number; body: unknown }

// Installs a fetch stub for the current test; node:test restores it afterwards.
function mockFetch(t: TestContext, reply: (url: string, init?: RequestInit) => Reply): void {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const { status, body } = reply(String(input), init)
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  })
}

// The next UTC month boundary, which is what a live monthly budget reports.
function nextMonthStart(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()
}

const emptySnapshot: Snapshot = {
  daily: null,
  monthly: null,
  limitTotal: null,
  limitRemaining: null,
}

describe("spendRatio", () => {
  it("divides only against a known positive total", () => {
    assert.equal(spendRatio(25, 100), 0.25)
    assert.equal(spendRatio(25, null), null)
    assert.equal(spendRatio(25, 0), null)
    assert.equal(spendRatio(null, 100), null)
  })
})

describe("resolveMonthlyLimit", () => {
  it("uses the API cap when the key exposes one", () => {
    const limit = resolveMonthlyLimit({ ...emptySnapshot, monthly: 25, limitTotal: 100, limitRemaining: 75 }, 50)
    assert.deepEqual(limit, { total: 100, remaining: 75, pct: 0.25 })
  })

  it("reconstructs the cap from spend plus remaining", () => {
    const limit = resolveMonthlyLimit({ ...emptySnapshot, monthly: 40, limitRemaining: 60 }, null)
    assert.deepEqual(limit, { total: 100, remaining: 60, pct: 0.4 })
  })

  it("falls back to the configured monthly limit", () => {
    const limit = resolveMonthlyLimit({ ...emptySnapshot, monthly: 30 }, 120)
    assert.deepEqual(limit, { total: 120, remaining: 90, pct: 0.25 })
  })

  it("reports no budget when neither source has one", () => {
    assert.deepEqual(resolveMonthlyLimit(emptySnapshot, null), { total: null, remaining: null, pct: null })
  })

  it("reports an overrun as a negative remaining balance", () => {
    const limit = resolveMonthlyLimit({ ...emptySnapshot, monthly: 130 }, 100)
    assert.deepEqual(limit, { total: 100, remaining: -30, pct: 1.3 })
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

  it("authenticates the key request", async (t) => {
    let headers: RequestInit["headers"]
    mockFetch(t, (_url, init) => {
      headers = init?.headers
      return { status: 200, body: { data: { usage_monthly: 1 } } }
    })

    await fetchSnapshot("sk-or-secret")
    const sent = headers as Record<string, string>
    assert.equal(sent.Authorization, "Bearer sk-or-secret")
    assert.equal(sent.Accept, "application/json")
  })

  it("prefers the member-scoped monthly budget", async (t) => {
    mockFetch(t, () => ({
      status: 200,
      body: {
        data: {
          usage_daily: 2,
          budgets: [
            {
              scope: "workspace_default_member",
              reset_interval: "monthly",
              resets_at: nextMonthStart(),
              spend_usd: 99,
              limit_usd: 999,
              remaining_usd: 900,
            },
            {
              scope: "member",
              reset_interval: "monthly",
              resets_at: nextMonthStart(),
              spend_usd: 45,
              limit_usd: 100,
              remaining_usd: 55,
            },
          ],
        },
      },
    }))

    const result = await fetchSnapshot("sk-or-member")
    assert.ok(result.ok, "expected a snapshot")
    assert.deepEqual(result.snapshot, {
      daily: 2,
      monthly: 45,
      limitTotal: 100,
      limitRemaining: 55,
    })
  })

  it("uses effective_budget when the key reports it directly", async (t) => {
    mockFetch(t, () => ({
      status: 200,
      body: {
        data: {
          usage_daily: 1,
          effective_budget: {
            scope: "member",
            reset_interval: "monthly",
            resets_at: nextMonthStart(),
            spend_usd: 12,
            limit_usd: 50,
            remaining_usd: 38,
          },
        },
      },
    }))

    const result = await fetchSnapshot("sk-or-effective")
    assert.ok(result.ok, "expected a snapshot")
    assert.deepEqual(result.snapshot, {
      daily: 1,
      monthly: 12,
      limitTotal: 50,
      limitRemaining: 38,
    })
  })

  it("accepts a monthly budget that reports no reset time", async (t) => {
    mockFetch(t, () => ({
      status: 200,
      body: {
        data: {
          budgets: [{ scope: "member", reset_interval: "monthly", spend_usd: 8, limit_usd: 40, remaining_usd: 32 }],
        },
      },
    }))

    const result = await fetchSnapshot("sk-or-no-reset")
    assert.ok(result.ok, "expected a snapshot")
    assert.equal(result.snapshot.monthly, 8)
    assert.equal(result.snapshot.limitTotal, 40)
  })

  it("ignores a budget that is not in the current monthly window", async (t) => {
    mockFetch(t, () => ({
      status: 200,
      body: {
        data: {
          usage_monthly: 7,
          budgets: [
            {
              scope: "member",
              reset_interval: "monthly",
              resets_at: "2020-01-01T00:00:00.000Z",
              spend_usd: 500,
              limit_usd: 600,
              remaining_usd: 100,
            },
          ],
        },
      },
    }))

    const result = await fetchSnapshot("sk-or-stale-window")
    assert.ok(result.ok, "expected a snapshot")
    assert.deepEqual(result.snapshot, {
      daily: null,
      monthly: 7,
      limitTotal: null,
      limitRemaining: null,
    })
  })
})
