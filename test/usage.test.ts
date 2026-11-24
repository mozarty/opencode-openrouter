import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { fetchSnapshot, resolveMonthlyLimit, resolveMonthlyPace, type Snapshot } from "../src/usage.ts"

type Reply = { status: number; body: unknown }

function stubFetch(reply: (url: string) => Reply): () => void {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request) => {
    const { status, body } = reply(String(input))
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  }) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
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
  workspace: null,
  workspaceName: null,
}

describe("resolveMonthlyLimit", () => {
  it("uses the API cap when the key exposes one", () => {
    const limit = resolveMonthlyLimit({ ...emptySnapshot, monthly: 25, limitTotal: 100, limitRemaining: 75 }, { monthlyLimit: 50 })
    assert.deepEqual(limit, { total: 100, remaining: 75, pct: 0.25 })
  })

  it("reconstructs the cap from spend plus remaining", () => {
    const limit = resolveMonthlyLimit({ ...emptySnapshot, monthly: 40, limitRemaining: 60 }, { monthlyLimit: null })
    assert.deepEqual(limit, { total: 100, remaining: 60, pct: 0.4 })
  })

  it("falls back to the configured monthly limit", () => {
    const limit = resolveMonthlyLimit({ ...emptySnapshot, monthly: 30 }, { monthlyLimit: 120 })
    assert.deepEqual(limit, { total: 120, remaining: 90, pct: 0.25 })
  })

  it("reports no budget when neither source has one", () => {
    assert.deepEqual(resolveMonthlyLimit(emptySnapshot, { monthlyLimit: null }), {
      total: null,
      remaining: null,
      pct: null,
    })
  })

  it("reports an overrun as a negative remaining balance", () => {
    const limit = resolveMonthlyLimit({ ...emptySnapshot, monthly: 130 }, { monthlyLimit: 100 })
    assert.deepEqual(limit, { total: 100, remaining: -30, pct: 1.3 })
  })
})

describe("resolveMonthlyPace", () => {
  it("projects month-end spend from elapsed UTC days", () => {
    const pace = resolveMonthlyPace(30, new Date(Date.UTC(2024, 1, 15)))
    assert.deepEqual(pace, { averagePerDay: 2, projected: 58 })
  })

  it("has no projection without spend", () => {
    assert.deepEqual(resolveMonthlyPace(null), { averagePerDay: null, projected: null })
  })
})

describe("fetchSnapshot", () => {
  it("reports a rejected key separately from an outage", async () => {
    const restore = stubFetch(() => ({ status: 401, body: { error: "invalid key" } }))
    try {
      assert.deepEqual(await fetchSnapshot("sk-or-bad", null), { ok: false, reason: "unauthorized" })
    } finally {
      restore()
    }
  })

  it("reports a server error as unavailable", async () => {
    const restore = stubFetch(() => ({ status: 503, body: null }))
    try {
      assert.deepEqual(await fetchSnapshot("sk-or-any", null), { ok: false, reason: "unavailable" })
    } finally {
      restore()
    }
  })

  it("reports a network failure as unavailable", async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error("ECONNRESET")
    }) as typeof fetch
    try {
      assert.deepEqual(await fetchSnapshot("sk-or-any", null), { ok: false, reason: "unavailable" })
    } finally {
      globalThis.fetch = original
    }
  })

  it("prefers the member-scoped monthly budget", async () => {
    const restore = stubFetch((url) =>
      url.endsWith("/auth/key")
        ? {
            status: 200,
            body: {
              data: {
                usage_daily: 2,
                usage_monthly: 10,
                workspace_id: "ws_member",
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
          }
        : { status: 404, body: null },
    )
    try {
      const result = await fetchSnapshot("sk-or-member", null)
      assert.equal(result.ok, true)
      assert.deepEqual(result.ok && result.snapshot, {
        daily: 2,
        monthly: 45,
        limitTotal: 100,
        limitRemaining: 55,
        workspace: "ws_member",
        workspaceName: null,
      })
    } finally {
      restore()
    }
  })

  it("uses effective_budget when the key reports it directly", async () => {
    const restore = stubFetch(() => ({
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
    try {
      const result = await fetchSnapshot("sk-or-effective", null)
      assert.equal(result.ok, true)
      assert.deepEqual(result.ok && result.snapshot, {
        daily: 1,
        monthly: 12,
        limitTotal: 50,
        limitRemaining: 38,
        workspace: null,
        workspaceName: null,
      })
    } finally {
      restore()
    }
  })

  it("ignores a budget that is not in the current monthly window", async () => {
    const restore = stubFetch(() => ({
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
    try {
      const result = await fetchSnapshot("sk-or-stale-window", null)
      assert.equal(result.ok, true)
      assert.deepEqual(result.ok && result.snapshot, {
        daily: null,
        monthly: 7,
        limitTotal: null,
        limitRemaining: null,
        workspace: null,
        workspaceName: null,
      })
    } finally {
      restore()
    }
  })

  it("resolves the workspace name from the management API", async () => {
    const restore = stubFetch((url) => {
      if (url.endsWith("/workspaces")) {
        return { status: 200, body: { data: [{ id: "ws_named", name: "Hackathon" }] } }
      }
      return { status: 200, body: { data: { usage_monthly: 1, workspace_id: "ws_named" } } }
    })
    try {
      const result = await fetchSnapshot("sk-or-named", "management-key-named")
      assert.equal(result.ok, true)
      assert.equal(result.ok && result.snapshot.workspaceName, "Hackathon")
    } finally {
      restore()
    }
  })

  it("still renders usage when the management key is rejected", async () => {
    const restore = stubFetch((url) => {
      if (url.endsWith("/workspaces")) return { status: 401, body: null }
      return { status: 200, body: { data: { usage_monthly: 3, workspace_id: "ws_unnamed" } } }
    })
    try {
      const result = await fetchSnapshot("sk-or-unnamed", "management-key-unnamed")
      assert.equal(result.ok, true)
      assert.equal(result.ok && result.snapshot.workspaceName, null)
      assert.equal(result.ok && result.snapshot.monthly, 3)
    } finally {
      restore()
    }
  })
})
