/** @jsxImportSource @opentui/solid */
// Sidebar widget: polls OpenRouter usage and renders daily/monthly spend, the
// monthly budget bar and a month-end forecast.
import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import type { RGBA } from "@opentui/core"
import type { Context } from "@opencode/plugin/tui/context"

import { ENV_API_KEY, INTEGRATION_ID, resolveCredential } from "./credentials"
import { bar, money, percent, severity, shortenId, type Severity } from "./format"
import { parseOptions, type PluginOptions } from "./options"
import {
  fetchSnapshot,
  resolveMonthlyLimit,
  resolveMonthlyPace,
  type MonthlyPace,
  type Snapshot,
  type SnapshotFailure,
} from "./usage"

const LABEL_WIDTH = 12
const BAR_WIDTH = 12
const DIVIDER_MIN_WIDTH = 26
const DIVIDER_OVERSHOOT = 2
const MIN_FETCH_INTERVAL_MS = 5_000

type Reason = SnapshotFailure | "no-key" | "not-configured" | "needs-auth"
type Status = "loading" | "ready" | "error"

type Palette = {
  chrome: string
  label: string
  value: string
  warning: string
  danger: string
  success: string
  divider: string
}

// Theme tokens are RGBA instances. Hex strings keep the span reconciler on its
// parseColor() string path and avoid RGBA class-instance mismatches on update.
function toHex(color: RGBA, alphaOverride?: number): string {
  const [r, g, b, a] = color.toInts()
  const alpha = alphaOverride == null ? a : Math.round(Math.max(0, Math.min(1, alphaOverride)) * 255)
  const channels = [r, g, b]
  if (alpha !== 255) channels.push(alpha)
  return `#${channels.map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")).join("")}`
}

function palette(theme: Context["theme"]): Palette {
  return {
    chrome: toHex(theme.text.action.primary.base),
    label: toHex(theme.text.muted),
    value: toHex(theme.text.base),
    warning: toHex(theme.text.feedback.warning.base),
    danger: toHex(theme.text.feedback.error.base),
    success: toHex(theme.text.feedback.success.base),
    divider: toHex(theme.text.action.primary.base, 0.35),
  }
}

function severityColor(colors: Palette, value: Severity): string {
  if (value === "danger") return colors.danger
  if (value === "warning") return colors.warning
  return colors.value
}

const REASON: Record<Reason, { label: string; hint?: string }> = {
  "not-configured": { label: "not connected", hint: "add an OpenRouter key" },
  "needs-auth": { label: "needs auth", hint: "sign in to OpenRouter" },
  "no-key": { label: "key not found", hint: `set ${ENV_API_KEY}` },
  unauthorized: { label: "key rejected", hint: "check the OpenRouter key" },
  unavailable: { label: "unreachable", hint: "retrying" },
}

function workspaceLabel(data: Snapshot, options: PluginOptions): string {
  if (data.workspaceName) return data.workspaceName
  const configured = data.workspace ? options.workspaces[data.workspace] : undefined
  return configured ?? shortenId(data.workspace)
}

// Sizes the rule slightly past the widest rendered metric row.
function dividerWidth(
  data: Snapshot,
  pace: MonthlyPace,
  monthSuffix: string | undefined,
  barText: string | undefined,
): number {
  const widestRow = Math.max(
    LABEL_WIDTH + money(data.daily).length,
    LABEL_WIDTH + money(pace.averagePerDay).length,
    LABEL_WIDTH + money(pace.projected).length,
    LABEL_WIDTH + money(data.monthly).length + (monthSuffix?.length ?? 0),
    barText ? LABEL_WIDTH + barText.length : 0,
  )
  return Math.max(DIVIDER_MIN_WIDTH, widestRow + DIVIDER_OVERSHOOT)
}

const Row = (props: {
  colors: Palette
  label: string
  value: string
  color?: string
  suffix?: string
}) => (
  <text>
    <span style={{ fg: props.colors.label }}>{props.label.padEnd(LABEL_WIDTH)}</span>
    <span style={{ fg: props.color ?? props.colors.value }}>{props.value}</span>
    {props.suffix && <span style={{ fg: props.colors.label }}>{props.suffix}</span>}
  </text>
)

const Divider = (props: { colors: Palette; width: number }) => (
  <text>
    <span style={{ fg: props.colors.divider }}>{"─".repeat(props.width)}</span>
  </text>
)

const Notice = (props: { colors: Palette; reason: Reason; stale: boolean }) => (
  <>
    <text>
      <span style={{ fg: props.colors.danger }}>✗ </span>
      <span style={{ fg: props.colors.label }}>{REASON[props.reason].label}</span>
      {props.stale && <span style={{ fg: props.colors.warning }}> · stale</span>}
    </text>
    {REASON[props.reason].hint && (
      <text>
        <span style={{ fg: props.colors.label }}>{`  ${REASON[props.reason].hint}`}</span>
      </text>
    )}
  </>
)

function connectionState(context: Context): "connected" | "missing" | "needs-auth" | "unknown" {
  const integrations = context.data.location.integration.list(context.location)
  if (!integrations) return "unknown"

  const integration = integrations.find((entry) => entry.id === INTEGRATION_ID)
  if (!integration) return "missing"
  if (integration.connections.some((connection) => connection.status?.status === "needs_auth")) return "needs-auth"
  return integration.connections.length > 0 ? "connected" : "missing"
}

export default Plugin.define({
  id: "opencode.openrouter",
  setup(context) {
    const options = parseOptions(context.options)
    const [snapshot, setSnapshot] = createSignal<Snapshot | null>(null)
    const [status, setStatus] = createSignal<Status>("loading")
    const [reason, setReason] = createSignal<Reason | null>(null)

    let disposed = false
    let lastFetchAt = 0
    let inFlight: AbortController | null = null

    async function refresh(force = false) {
      if (disposed) return
      if (!force && Date.now() - lastFetchAt < MIN_FETCH_INTERVAL_MS) return

      lastFetchAt = Date.now()
      inFlight?.abort()
      const controller = new AbortController()
      inFlight = controller

      // Re-resolve on every refresh so credential switches take effect immediately.
      const credential = await resolveCredential()
      if (disposed || controller.signal.aborted) return

      if (!credential) {
        const connection = connectionState(context)
        setReason(connection === "missing" ? "not-configured" : connection === "needs-auth" ? "needs-auth" : "no-key")
        setStatus("error")
        return
      }

      const result = await fetchSnapshot(credential.key, options.managementKey, controller.signal)
      if (disposed || controller.signal.aborted) return

      if (result.ok) {
        setSnapshot(result.snapshot)
        setReason(null)
        setStatus("ready")
        return
      }

      setReason(result.reason)
      setStatus("error")
    }

    // Integration metadata drives the "not configured" vs "key not readable"
    // distinction. The secret itself is never exposed by the plugin API.
    void context.data.location.integration
      .sync(context.location)
      .catch(() => {})
      .then(() => refresh())

    const timer = setInterval(() => void refresh(), options.refreshIntervalMs)

    const stops = [
      // Throttled: spend changes after a model turn.
      context.data.on("session.usage.updated", () => void refresh()),
      context.data.on("session.execution.succeeded", () => void refresh()),
      // Unthrottled: the key or the connected integrations changed.
      context.data.on("session.created", () => void refresh(true)),
      context.data.on("credential.switched", () => void refresh(true)),
      context.data.on("credential.updated", () => void refresh(true)),
      context.data.on("integration.updated", () => {
        context.data.location.integration.invalidate(context.location)
        void refresh(true)
      }),
    ]

    context.keymap.layer(() => ({
      commands: [
        {
          id: "openrouter.refresh",
          title: `Refresh ${options.title} usage`,
          group: options.title,
          palette: true,
          run: () => void refresh(true),
        },
      ],
    }))

    const disposeSlot = context.ui.slot({
      append: "sidebar.content",
      render: () => {
        const colors = palette(context.theme)
        const current = status()
        const data = snapshot()
        const stale = current === "error" && data != null
        const activeReason = reason()

        return (
          <box
            border={true}
            borderStyle="rounded"
            borderColor={colors.chrome}
            title={` ${options.title} `}
            titleColor={colors.chrome}
            padding={1}
          >
            {stale && activeReason && <Notice colors={colors} reason={activeReason} stale={true} />}
            {!data && current === "error" && activeReason && (
              <Notice colors={colors} reason={activeReason} stale={false} />
            )}
            {!data && current === "loading" && (
              <text>
                <span style={{ fg: colors.label }}>loading…</span>
              </text>
            )}
            {data &&
              (() => {
                const limit = resolveMonthlyLimit(data, options)
                const pace = resolveMonthlyPace(data.monthly)
                const monthColor = severityColor(colors, severity(limit.pct))
                const forecastPct =
                  limit.total != null && limit.total > 0 && pace.projected != null ? pace.projected / limit.total : null
                const forecastColor = severityColor(colors, severity(forecastPct))
                const remainingColor = limit.remaining != null && limit.remaining < 0 ? colors.danger : colors.success
                const monthSuffix = limit.total != null ? ` / ${money(limit.total)}` : undefined
                const barText = limit.pct != null ? `${bar(limit.pct, BAR_WIDTH)} ${percent(limit.pct)}` : undefined
                const width = dividerWidth(data, pace, monthSuffix, barText)

                return (
                  <>
                    <text>
                      <span style={{ fg: colors.chrome }}>◆ </span>
                      <span style={{ fg: colors.label }}>{workspaceLabel(data, options)}</span>
                      {limit.remaining != null && (
                        <span style={{ fg: remainingColor }}>{`  ${money(limit.remaining)}`}</span>
                      )}
                    </text>
                    <box>
                      <text>{" "}</text>
                      <Row colors={colors} label="Today" value={money(data.daily)} />
                      <Divider colors={colors} width={width} />
                      <Row colors={colors} label="Avg/day" value={money(pace.averagePerDay)} />
                      <Divider colors={colors} width={width} />
                      <Row colors={colors} label="Forecast" value={money(pace.projected)} color={forecastColor} />
                      <Divider colors={colors} width={width} />
                      <Row
                        colors={colors}
                        label="Month"
                        value={money(data.monthly)}
                        color={monthColor}
                        suffix={monthSuffix}
                      />
                      {barText && <Row colors={colors} label="" value={barText} color={monthColor} />}
                    </box>
                  </>
                )
              })()}
          </box>
        )
      },
    })

    return () => {
      disposed = true
      inFlight?.abort()
      clearInterval(timer)
      for (const stop of stops) {
        try {
          stop()
        } catch {}
      }
      try {
        disposeSlot()
      } catch {}
    }
  },
})
