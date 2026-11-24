// Talks to the OpenRouter API and reconciles the budgets into the snapshot the
// sidebar renders. Network and parsing failures are reported as a discriminated
// result so the widget can tell "bad key" from "offline".
//
// Spend rows are always scoped to the current key (`usage_daily`,
// `usage_monthly`), while the budget is whatever layer OpenRouter enforces, so
// the percentage compares like with like.
export type Snapshot = {
  daily: number | null
  monthly: number | null
  budget: BudgetCap | null
}

export type BudgetWindow = "day" | "week" | "month"

// One spending cap with the spend counted against it. `window` is null for a
// lifetime budget that never resets.
export type BudgetCap = {
  window: BudgetWindow | null
  total: number
  spend: number
  remaining: number
}

export type ResolvedBudget = {
  window: BudgetWindow | null
  total: number
  spend: number | null
  remaining: number
  pct: number | null
}

export type SnapshotFailure = "unauthorized" | "unavailable"

export type SnapshotResult = { ok: true; snapshot: Snapshot } | { ok: false; reason: SnapshotFailure }

const API_BASE = "https://openrouter.ai/api/v1"
const REQUEST_TIMEOUT_MS = 10_000

const RESET_WINDOWS: Readonly<Record<string, BudgetWindow>> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
}

type FetchResult = { status: number; body: unknown }

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
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

// The reset interval decides the window a budget is counted over, so an
// interval the plugin does not understand is treated as "not a budget" rather
// than silently mislabelled as monthly.
function windowFromReset(value: unknown): BudgetWindow | null {
  if (typeof value !== "string") return null
  return RESET_WINDOWS[value] ?? null
}

function isResetInterval(value: unknown): boolean {
  return value == null || (typeof value === "string" && value in RESET_WINDOWS)
}

// A budget is current when its window has not rolled over yet. A budget without
// a reset time (a lifetime cap) always counts.
function isCurrentWindow(resetsAt: unknown, now: number): boolean {
  if (typeof resetsAt !== "string" || !resetsAt) return true
  const reset = Date.parse(resetsAt)
  return Number.isNaN(reset) ? true : reset > now
}

// Reads one `budgets[]` entry. The limit and at least one side of the spend
// have to describe the same window, so the missing side is reconstructed and an
// entry that cannot be reconciled is dropped.
function budgetFromEntry(value: unknown, now: number): BudgetCap | null {
  const entry = record(value)
  if (!entry || typeof entry.scope !== "string") return null
  if (!isResetInterval(entry.reset_interval)) return null
  if (!isCurrentWindow(entry.resets_at, now)) return null

  const total = num(entry.limit_usd)
  if (total == null || total <= 0) return null

  const remaining = num(entry.remaining_usd)
  const spend = num(entry.spend_usd) ?? (remaining != null ? total - remaining : null)
  const left = remaining ?? (spend != null ? total - spend : null)
  if (spend == null || left == null) return null

  return { window: windowFromReset(entry.reset_interval), total, spend, remaining: left }
}

// Which usage field counts as spend inside each window. The key's own limit has
// no budget entry carrying the spend, so it is read from the usage totals.
const WINDOW_USAGE: Readonly<Record<BudgetWindow, string>> = {
  day: "usage_daily",
  week: "usage_weekly",
  month: "usage_monthly",
}

function windowSpend(data: Record<string, unknown>, window: BudgetWindow | null): number | null {
  const field = window ? WINDOW_USAGE[window] : null
  return field ? num(data[field]) : null
}

// A key's own credit limit is not listed in `budgets[]` until it is spent, so it
// is read from `limit` / `limit_remaining` together with `limit_reset`.
function budgetFromKeyLimit(data: Record<string, unknown>, window: BudgetWindow | null): BudgetCap | null {
  const total = num(data.limit)
  if (total == null || total <= 0) return null

  const remaining = num(data.limit_remaining)
  const spend = windowSpend(data, window)
  if (remaining == null && spend == null) return null

  const left = remaining ?? (spend != null ? total - spend : 0)
  return { window, total, spend: spend ?? total - left, remaining: left }
}

function leastRemaining(budgets: readonly BudgetCap[]): BudgetCap | null {
  let picked: BudgetCap | null = null
  for (const budget of budgets) {
    if (!picked || budget.remaining < picked.remaining) picked = budget
  }
  return picked
}

// Resolves the cap enforcement actually checks, in the order OpenRouter checks
// it: the budget that blocks first, then the tightest of the remaining layers,
// then the key's own limit.
export function pickBudget(data: Record<string, unknown>, now = Date.now()): BudgetCap | null {
  const effective = budgetFromEntry(data.effective_budget, now)
  if (effective) return effective

  const candidates: BudgetCap[] = []
  const budgets = Array.isArray(data.budgets) ? data.budgets : []
  for (const entry of budgets) {
    const budget = budgetFromEntry(entry, now)
    if (budget) candidates.push(budget)
  }
  const tightest = leastRemaining(candidates)
  if (tightest) return tightest

  if (!isResetInterval(data.limit_reset)) return null
  return budgetFromKeyLimit(data, windowFromReset(data.limit_reset))
}

export async function fetchSnapshot(key: string, signal?: AbortSignal): Promise<SnapshotResult> {
  const keyInfo = await request(`${API_BASE}/key`, key, signal)

  if (!keyInfo) return { ok: false, reason: "unavailable" }
  if (keyInfo.status === 401 || keyInfo.status === 403) return { ok: false, reason: "unauthorized" }
  if (keyInfo.status !== 200) return { ok: false, reason: "unavailable" }

  const data = record(record(keyInfo.body)?.data)
  if (!data) return { ok: false, reason: "unavailable" }

  return {
    ok: true,
    snapshot: {
      daily: num(data.usage_daily),
      monthly: num(data.usage_monthly),
      budget: pickBudget(data),
    },
  }
}

// Resolves the cap the sidebar draws. The API budget wins because it is the one
// enforcement uses; the configured `monthlyLimit` is only a fallback for keys
// without one.
export function resolveBudget(data: Snapshot, monthlyLimit: number | null): ResolvedBudget | null {
  if (data.budget) {
    return {
      window: data.budget.window,
      total: data.budget.total,
      spend: data.budget.spend,
      remaining: data.budget.remaining,
      pct: spendRatio(data.budget.spend, data.budget.total),
    }
  }

  if (monthlyLimit != null && monthlyLimit > 0) {
    return {
      window: "month",
      total: monthlyLimit,
      spend: data.monthly,
      remaining: data.monthly != null ? monthlyLimit - data.monthly : monthlyLimit,
      pct: spendRatio(data.monthly, monthlyLimit),
    }
  }

  return null
}

// Guards the divide: only a known positive total yields a percentage.
export function spendRatio(spend: number | null, total: number | null): number | null {
  return spend != null && total != null && total > 0 ? spend / total : null
}

// Average spend per elapsed UTC day this month, today included.
export function averagePerDay(monthly: number | null, now = new Date()): number | null {
  if (monthly == null) return null
  return monthly / now.getUTCDate()
}
