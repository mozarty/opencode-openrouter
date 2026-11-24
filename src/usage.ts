// Talks to the OpenRouter API and reconciles key/workspace budgets into the
// snapshot the sidebar renders. Network and parsing failures are reported as a
// discriminated result so the widget can tell "bad key" from "offline".
export type Snapshot = {
  daily: number | null
  monthly: number | null
  limitTotal: number | null
  limitRemaining: number | null
  workspace: string | null
  workspaceName: string | null
}

export type MonthlyLimit = {
  total: number | null
  remaining: number | null
  pct: number | null
}

export type MonthlyPace = {
  averagePerDay: number | null
  projected: number | null
}

export type SnapshotFailure = "unauthorized" | "unavailable"

export type SnapshotResult =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; reason: SnapshotFailure }

const API_BASE = "https://openrouter.ai/api/v1"
const REQUEST_TIMEOUT_MS = 10_000
const WORKSPACE_CACHE_TTL_MS = 10 * 60_000

type BudgetEntry = {
  scope?: string
  reset_interval?: string | null
  resets_at?: string | null
  spend_usd?: unknown
  limit_usd?: unknown
  remaining_usd?: unknown
}

type FetchResult = { status: number; body: unknown }

let workspaceCache: { key: string; at: number; map: Map<string, string> } | null = null

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

// Aborts on timeout or caller cancellation so a hung request cannot wedge the
// poll loop.
async function request(url: string, key: string, signal?: AbortSignal): Promise<FetchResult | null> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    const body: unknown = await res.json().catch(() => null)
    return { status: res.status, body }
  } catch {
    return null
  }
}

async function workspaceNames(managementKey: string, signal?: AbortSignal): Promise<Map<string, string>> {
  const cached = workspaceCache
  if (cached && cached.key === managementKey && Date.now() - cached.at < WORKSPACE_CACHE_TTL_MS) {
    return cached.map
  }

  const res = await request(`${API_BASE}/workspaces`, managementKey, signal)
  const list = record(res?.body)
  const map = new Map<string, string>()
  if (Array.isArray(list?.data)) {
    for (const item of list.data) {
      const workspace = record(item)
      if (typeof workspace?.id === "string" && typeof workspace.name === "string") {
        map.set(workspace.id, workspace.name)
      }
    }
  }

  // Only cache a successful listing; a bad management key should be retried.
  if (res?.status === 200 && map.size > 0) {
    workspaceCache = { key: managementKey, at: Date.now(), map }
  }
  return map
}

// Lets an explicit refresh pick up renamed or deleted workspaces instead of
// serving the cached listing until it expires.
export function resetWorkspaceCache(): void {
  workspaceCache = null
}

// A monthly budget is the current window when it resets at the next UTC month
// boundary. A budget without `resets_at` is treated as current.
function isCurrentMonthlyWindow(resetsAt: unknown): boolean {
  if (typeof resetsAt !== "string" || !resetsAt) return true
  const now = new Date()
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0)
  return Date.parse(resetsAt) === next
}

function isUtcMonthlyBudget(value: unknown, ...scopes: string[]): value is BudgetEntry {
  const budget = record(value)
  if (!budget) return false
  if (budget.reset_interval !== "monthly") return false
  if (!isCurrentMonthlyWindow(budget.resets_at)) return false
  return typeof budget.scope === "string" && scopes.includes(budget.scope)
}

// Prefers the member-scoped budget over the workspace default, since that is
// the cap the current key actually spends against.
function pickMemberMonthlyBudget(keyData: Record<string, unknown>, budgets: unknown[]): BudgetEntry | null {
  const direct = keyData.effective_budget
  if (isUtcMonthlyBudget(direct, "member", "workspace_default_member")) return direct

  return (
    budgets.find((budget) => isUtcMonthlyBudget(budget, "member")) ??
    budgets.find((budget) => isUtcMonthlyBudget(budget, "workspace_default_member")) ??
    null
  )
}

export async function fetchSnapshot(
  key: string,
  managementKey: string | null,
  signal?: AbortSignal,
): Promise<SnapshotResult> {
  const [keyInfo, names] = await Promise.all([
    request(`${API_BASE}/auth/key`, key, signal),
    managementKey ? workspaceNames(managementKey, signal) : Promise.resolve(null),
  ])

  if (!keyInfo) return { ok: false, reason: "unavailable" }
  if (keyInfo.status === 401 || keyInfo.status === 403) return { ok: false, reason: "unauthorized" }
  if (keyInfo.status !== 200) return { ok: false, reason: "unavailable" }

  const data = record(record(keyInfo.body)?.data)
  if (!data) return { ok: false, reason: "unavailable" }

  const workspace = typeof data.workspace_id === "string" && data.workspace_id ? data.workspace_id : null
  const workspaceName = workspace && names ? (names.get(workspace) ?? null) : null

  const budgets = Array.isArray(data.budgets) ? data.budgets : []
  const memberBudget = pickMemberMonthlyBudget(data, budgets)

  return {
    ok: true,
    snapshot: {
      daily: num(data.usage_daily),
      monthly: num(memberBudget?.spend_usd) ?? num(data.usage_monthly),
      limitTotal: num(memberBudget?.limit_usd) ?? num(data.limit),
      limitRemaining: num(memberBudget?.remaining_usd) ?? num(data.limit_remaining),
      workspace,
      workspaceName,
    },
  }
}

// Resolves the monthly cap and remaining balance from the API snapshot. Keys
// without an API-level cap fall back to the configured `monthlyLimit`.
export function resolveMonthlyLimit(data: Snapshot, monthlyLimit: number | null): MonthlyLimit {
  if (data.limitRemaining != null) {
    const total =
      data.limitTotal != null && data.limitTotal > 0
        ? data.limitTotal
        : data.monthly != null
          ? data.monthly + data.limitRemaining
          : null
    return { total, remaining: data.limitRemaining, pct: spendRatio(data.monthly, total) }
  }

  if (monthlyLimit != null && monthlyLimit > 0) {
    return {
      total: monthlyLimit,
      remaining: data.monthly != null ? monthlyLimit - data.monthly : monthlyLimit,
      pct: spendRatio(data.monthly, monthlyLimit),
    }
  }

  return { total: null, remaining: null, pct: null }
}

// Guards the divide: only a known positive total yields a percentage.
export function spendRatio(spend: number | null, total: number | null): number | null {
  return spend != null && total != null && total > 0 ? spend / total : null
}

// Uses elapsed UTC calendar days, today included, to estimate this month's
// average daily spend and the month-end total at the same pace.
export function resolveMonthlyPace(monthly: number | null, now = new Date()): MonthlyPace {
  if (monthly == null) return { averagePerDay: null, projected: null }

  const daysElapsed = now.getUTCDate()
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
  const averagePerDay = monthly / daysElapsed

  return { averagePerDay, projected: averagePerDay * daysInMonth }
}
