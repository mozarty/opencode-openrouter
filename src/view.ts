// Turns a snapshot into the lines the sidebar prints. Kept pure so the labels,
// the budget window and the severity colours are testable without a renderer.
import { bar, money, percent, severity } from "./format.ts"
import { averagePerDay, resolveBudget, type BudgetWindow, type Snapshot } from "./usage.ts"

export const LABEL_WIDTH = 12
export const BAR_WIDTH = 12
export const DIVIDER_MIN_WIDTH = 26
const DIVIDER_OVERSHOOT = 2

export type Tone = "today" | "value" | "average" | "success" | "warning" | "danger"

export type UsageLine =
  | { readonly kind: "rule" }
  | { readonly kind: "row"; readonly label: string; readonly value: string; readonly tone: Tone }

export type UsageView = {
  readonly lines: readonly UsageLine[]
  readonly width: number
}

const WINDOW_LABEL: Readonly<Record<BudgetWindow, string>> = {
  day: "Day cap",
  week: "Week cap",
  month: "Month cap",
}

function capLabel(window: BudgetWindow | null): string {
  return window ? WINDOW_LABEL[window] : "Cap"
}

function pressureTone(pct: number | null): Tone {
  const level = severity(pct)
  if (level === "danger") return "danger"
  if (level === "warning") return "warning"
  return "value"
}

// Today, Month and Avg/day stay scoped to the current key. The budget block is
// whatever layer OpenRouter enforces, so the percentage always compares the
// spend the API counts against the cap it counts it against.
export function usageView(data: Snapshot, monthlyLimit: number | null, now = new Date()): UsageView {
  const budget = resolveBudget(data, monthlyLimit)
  const capTone = pressureTone(budget?.pct ?? null)

  const lines: UsageLine[] = [
    { kind: "row", label: "Today", value: money(data.daily), tone: "today" },
    { kind: "rule" },
    { kind: "row", label: "Month", value: money(data.monthly), tone: "value" },
    { kind: "row", label: "Avg/day", value: money(averagePerDay(data.monthly, now)), tone: "average" },
  ]

  if (budget) {
    lines.push(
      { kind: "rule" },
      {
        kind: "row",
        label: "Remaining",
        value: money(budget.remaining),
        tone: budget.remaining < 0 ? "danger" : "success",
      },
      {
        kind: "row",
        label: capLabel(budget.window),
        value: `${money(budget.spend)} / ${money(budget.total)}`,
        tone: capTone,
      },
    )

    if (budget.pct != null) {
      lines.push({
        kind: "row",
        label: "",
        value: `${bar(budget.pct, BAR_WIDTH)} ${percent(budget.pct)}`,
        tone: capTone,
      })
    }
  }

  const widest = Math.max(...lines.map((line) => (line.kind === "row" ? LABEL_WIDTH + line.value.length : 0)))

  return { lines, width: Math.max(DIVIDER_MIN_WIDTH, widest + DIVIDER_OVERSHOOT) }
}
