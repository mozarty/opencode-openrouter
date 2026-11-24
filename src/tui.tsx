/** @jsxImportSource @opentui/solid */
// Sidebar widget: polls OpenRouter usage and renders daily/monthly spend, the
// monthly budget bar and a month-end forecast.
import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import type { Context } from "@opencode/plugin/tui/context"

import { ENV_API_KEY, INTEGRATION_ID, resolveCredential } from "./credentials"
import { bar, money, percent, severity, workspaceLabel } from "./format"
import { parseOptions, type PluginOptions } from "./options"
import { buildPalette, HUE_STEPS, pickVivid, severityColor, toHex, type Palette, type PaletteTokens } from "./theme-colors"
import {
  fetchSnapshot,
  resetWorkspaceCache,
  resolveMonthlyLimit,
  resolveMonthlyPace,
  spendRatio,
  type Snapshot,
  type SnapshotFailure,
} from "./usage"

const LABEL_WIDTH = 12
const BAR_WIDTH = 12
const DIVIDER_MIN_WIDTH = 26
const DIVIDER_OVERSHOOT = 2
const MIN_FETCH_INTERVAL_MS = 5_000

type Reason = SnapshotFailure | "no-key" | "not-configured" | "needs-auth"

// Picks distinct hues out of the theme so every metric is its own color. The
// step holding each hue's base colour is chosen by colourfulness and contrast,
// so a legacy or current theme layout both land on the vivid shade. A
// categorical hue that would collide with the accent is skipped.
function themeTokens(theme: Context["theme"]): PaletteTokens {
  const background = theme.background.base
  const vivid = (scale: Context["theme"]["hue"]["accent"]) => pickVivid(HUE_STEPS.map((step) => scale[step]), background)

  const accent = vivid(theme.hue.accent) ?? theme.text.base
  const accentHex = toHex(accent)
  const secondary = theme.categorical
    .map((scale) => vivid(scale))
    .find((color) => color != null && toHex(color) !== accentHex)

  return {
    accent,
    label: theme.text.base,
    base: theme.text.base,
    info: theme.text.feedback.info.base,
    secondary: secondary ?? theme.text.feedback.info.base,
    warning: theme.text.feedback.warning.base,
    danger: theme.text.feedback.error.base,
    success: theme.text.feedback.success.base,
  }
}

const REASON: Record<Reason, { label: string; hint?: string }> = {
  "not-configured": { label: "not connected", hint: "add an OpenRouter key" },
  "needs-auth": { label: "needs auth", hint: "sign in to OpenRouter" },
  "no-key": { label: "key not found", hint: `set ${ENV_API_KEY}` },
  unauthorized: { label: "key rejected", hint: "check the OpenRouter key" },
  unavailable: { label: "unreachable", hint: "retrying" },
}

function missingKeyReason(context: Context): Reason {
  const integrations = context.data.location.integration.list(context.location)
  if (!integrations) return "no-key"

  const integration = integrations.find((entry) => entry.id === INTEGRATION_ID)
  if (!integration) return "not-configured"
  if (integration.connections.some((connection) => connection.status?.status === "needs_auth")) return "needs-auth"
  return "no-key"
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

const Notice = (props: { colors: Palette; reason: Reason; stale: boolean }) => {
  const { label, hint } = REASON[props.reason]

  return (
    <>
      <text>
        <span style={{ fg: props.colors.danger }}>✗ </span>
        <span style={{ fg: props.colors.label }}>{label}</span>
        {props.stale && <span style={{ fg: props.colors.warning }}> · stale</span>}
      </text>
      {hint && (
        <text>
          <span style={{ fg: props.colors.label }}>{`  ${hint}`}</span>
        </text>
      )}
    </>
  )
}

const Usage = (props: { colors: Palette; data: Snapshot; options: PluginOptions }) => {
  const { colors, data, options } = props
  const limit = resolveMonthlyLimit(data, options.monthlyLimit)
  const pace = resolveMonthlyPace(data.monthly)

  const daily = money(data.daily)
  const average = money(pace.averagePerDay)
  const forecast = money(pace.projected)
  const month = money(data.monthly)
  const monthSuffix = limit.total != null ? ` / ${money(limit.total)}` : ""
  const barText = limit.pct != null ? `${bar(limit.pct, BAR_WIDTH)} ${percent(limit.pct)}` : ""

  // The rule spans the widest rendered row, so derive it from the formatted
  // strings that are actually drawn instead of re-formatting the numbers.
  const widest = Math.max(
    ...[daily, average, forecast, `${month}${monthSuffix}`, barText].map((value) => LABEL_WIDTH + value.length),
  )
  const width = Math.max(DIVIDER_MIN_WIDTH, widest + DIVIDER_OVERSHOOT)

  const monthColor = severityColor(colors, severity(limit.pct), colors.value)
  const forecastColor = severityColor(colors, severity(spendRatio(pace.projected, limit.total)), colors.forecast)
  const remainingColor = limit.remaining != null && limit.remaining < 0 ? colors.danger : colors.success

  return (
    <>
      <text>
        <span style={{ fg: colors.accent }}>◆ </span>
        <span style={{ fg: colors.label }}>{workspaceLabel(data.workspace, data.workspaceName, options.workspaces)}</span>
        {limit.remaining != null && <span style={{ fg: remainingColor }}>{`  ${money(limit.remaining)}`}</span>}
      </text>
      <box>
        <text>{" "}</text>
        <Row colors={colors} label="Today" value={daily} color={colors.today} />
        <Divider colors={colors} width={width} />
        <Row colors={colors} label="Avg/day" value={average} color={colors.average} />
        <Divider colors={colors} width={width} />
        <Row colors={colors} label="Forecast" value={forecast} color={forecastColor} />
        <Divider colors={colors} width={width} />
        <Row colors={colors} label="Month" value={month} color={monthColor} suffix={monthSuffix} />
        {barText && <Row colors={colors} label="" value={barText} color={monthColor} />}
      </box>
    </>
  )
}

const Loading = (props: { colors: Palette }) => (
  <text>
    <span style={{ fg: props.colors.label }}>loading…</span>
  </text>
)

export default Plugin.define({
  id: "opencode.openrouter",
  setup(context) {
    const options = parseOptions(context.options)
    const [snapshot, setSnapshot] = createSignal<Snapshot | null>(null)
    const [reason, setReason] = createSignal<Reason | null>(null)

    let disposed = false
    let lastFetchAt = 0
    let inFlight: AbortController | null = null
    let credential: string | null = null

    async function refresh(force = false) {
      if (disposed) return
      if (!force && Date.now() - lastFetchAt < MIN_FETCH_INTERVAL_MS) return

      lastFetchAt = Date.now()
      inFlight?.abort()
      const controller = new AbortController()
      inFlight = controller

      if (!credential) {
        setReason(missingKeyReason(context))
        return
      }

      const result = await fetchSnapshot(credential, options.managementKey, controller.signal)
      if (disposed || controller.signal.aborted) return

      if (result.ok) {
        setSnapshot(result.snapshot)
        setReason(null)
        return
      }

      setReason(result.reason)
    }

    // Read the key once and re-read it only when it changes: the credential
    // store is a synchronous SQLite lookup that must not run on every poll.
    async function loadCredential() {
      credential = await resolveCredential()
      await refresh(true)
    }

    // Integration metadata drives the "not configured" vs "key not readable"
    // distinction. The secret itself is never exposed by the plugin API.
    void (async () => {
      await context.data.location.integration.sync(context.location).catch(() => {})
      await loadCredential()
    })()

    const timer = setInterval(() => void refresh(), options.refreshIntervalMs)

    const stops = [
      // Throttled: spend changes after a model turn. New sessions land here too,
      // because a burst of subagent sessions must not abort the fetch in flight.
      context.data.on("session.usage.updated", () => void refresh()),
      context.data.on("session.execution.succeeded", () => void refresh()),
      context.data.on("session.created", () => void refresh()),
      // Unthrottled: the key or the connected integrations changed.
      context.data.on("credential.switched", () => void loadCredential()),
      context.data.on("credential.updated", () => void loadCredential()),
      context.data.on("integration.updated", () => {
        context.data.location.integration.invalidate(context.location)
        resetWorkspaceCache()
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
        const colors = buildPalette(themeTokens(context.theme), { accentOverride: options.accent })
        const data = snapshot()
        const activeReason = reason()

        return (
          <box
            border={true}
            borderStyle="rounded"
            borderColor={colors.accent}
            title={` ${options.title} `}
            titleColor={colors.accent}
            padding={1}
          >
            {activeReason && <Notice colors={colors} reason={activeReason} stale={data != null} />}
            {!data && !activeReason && <Loading colors={colors} />}
            {data && <Usage colors={colors} data={data} options={options} />}
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
