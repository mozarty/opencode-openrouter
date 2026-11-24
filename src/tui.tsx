/** @jsxImportSource @opentui/solid */
// Sidebar widget: polls OpenRouter usage and renders daily/monthly spend, the
// budget bar and the remaining budget.
import { Plugin } from "@opencode/plugin/tui"
import { createSignal, For } from "solid-js"
import type { Context } from "@opencode/plugin/tui/context"

import { ENV_API_KEY, INTEGRATION_ID, resolveCredential } from "./credentials.ts"
import { EVENT_THROTTLE_MS, parseOptions, type PluginOptions } from "./options.ts"
import { buildPalette, HUE_STEPS, pickVivid, toHex, type Palette, type PaletteTokens } from "./theme-colors.ts"
import { fetchSnapshot, type Snapshot, type SnapshotFailure } from "./usage.ts"
import { LABEL_WIDTH, usageView, type Tone } from "./view.ts"

type Theme = Context["theme"]

type Reason = SnapshotFailure | "no-key" | "not-configured" | "needs-auth" | "syncing"

const REASON: Readonly<Record<Reason, { label: string; hint?: string; tone: "error" | "warning" }>> = {
  "not-configured": { label: "not connected", hint: "add an OpenRouter key", tone: "error" },
  "needs-auth": { label: "needs auth", hint: "sign in to OpenRouter", tone: "error" },
  "no-key": { label: "key not found", hint: `set ${ENV_API_KEY}`, tone: "error" },
  unauthorized: { label: "key rejected", hint: "check the OpenRouter key", tone: "error" },
  unavailable: { label: "unreachable", hint: "retrying", tone: "warning" },
  syncing: { label: "checking key", hint: "reading OpenCode integrations", tone: "warning" },
}

// Picks distinct hues out of the theme so every metric is its own color. The
// step holding each hue's base colour is chosen by colourfulness and contrast,
// so a legacy or current theme layout both land on the vivid shade. A
// categorical hue that would collide with the accent is skipped.
function themeTokens(theme: Theme): PaletteTokens {
  const background = theme.background.base
  const vivid = (scale: Theme["hue"]["accent"]) =>
    pickVivid(
      HUE_STEPS.map((step) => scale[step]),
      background,
    )

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

function missingKeyReason(context: Context): Reason {
  const integrations = context.data.location.integration.list(context.location)
  if (!integrations) return "syncing"

  const integration = integrations.find((entry) => entry.id === INTEGRATION_ID)
  if (!integration) return "not-configured"
  if (integration.connections.some((connection) => connection.status?.status === "needs_auth")) return "needs-auth"
  return "no-key"
}

function toneColor(colors: Palette, tone: Tone): string {
  switch (tone) {
    case "today":
      return colors.today
    case "average":
      return colors.average
    case "success":
      return colors.success
    case "warning":
      return colors.warning
    case "danger":
      return colors.danger
    case "value":
      return colors.value
  }
}

const Row = (props: { colors: Palette; label: string; value: string; tone: Tone }) => (
  <text>
    <span style={{ fg: props.colors.label }}>{props.label.padEnd(LABEL_WIDTH)}</span>
    <span style={{ fg: toneColor(props.colors, props.tone) }}>{props.value}</span>
  </text>
)

const Divider = (props: { colors: Palette; width: number }) => (
  <text>
    <span style={{ fg: props.colors.divider }}>{"─".repeat(props.width)}</span>
  </text>
)

const Notice = (props: { colors: Palette; reason: Reason; stale: boolean }) => {
  const { label, hint, tone } = REASON[props.reason]

  return (
    <>
      <text>
        <span style={{ fg: tone === "error" ? props.colors.danger : props.colors.warning }}>
          {tone === "error" ? "✗ " : "⚠ "}
        </span>
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
  // Read lazily so the rows follow the snapshot even if the slot re-renders
  // without recreating the subtree.
  const view = () => usageView(props.data, props.options.monthlyLimit)

  return (
    <box>
      <For each={view().lines}>
        {(line) =>
          line.kind === "rule" ? (
            <Divider colors={props.colors} width={view().width} />
          ) : (
            <Row colors={props.colors} label={line.label} value={line.value} tone={line.tone} />
          )
        }
      </For>
    </box>
  )
}

const Loading = (props: { colors: Palette }) => (
  <text>
    <span style={{ fg: props.colors.label }}>loading…</span>
  </text>
)

export default Plugin.define({
  id: "openrouter.sidebar",
  setup(context) {
    const options = parseOptions(context.options)
    const [snapshot, setSnapshot] = createSignal<Snapshot | null>(null)
    const [reason, setReason] = createSignal<Reason | null>(null)

    let disposed = false
    let lastFetchAt = 0
    let inFlight: AbortController | null = null
    let credential: string | null = null

    // The palette is a pure function of the theme and the accent override, so
    // caching by identity keeps the hue search out of every render.
    let paletteCache: { theme: Theme; accent: string | null; palette: Palette } | null = null
    const paletteFor = (theme: Theme, accent: string | null): Palette => {
      if (paletteCache?.theme !== theme || paletteCache.accent !== accent) {
        paletteCache = { theme, accent, palette: buildPalette(themeTokens(theme), { accentOverride: accent }) }
      }
      return paletteCache.palette
    }

    // Resolves true when a fresh snapshot landed. New sessions and completed
    // turns land here too, throttled so a burst of subagent sessions cannot
    // abort the fetch in flight or hammer the API.
    async function refresh(force = false): Promise<boolean> {
      if (disposed) return false

      if (!credential) {
        inFlight?.abort()
        inFlight = null
        setReason(missingKeyReason(context))
        return false
      }

      if (!force && Date.now() - lastFetchAt < EVENT_THROTTLE_MS) return false

      lastFetchAt = Date.now()
      inFlight?.abort()
      const controller = new AbortController()
      inFlight = controller

      const result = await fetchSnapshot(credential, controller.signal)
      if (disposed || controller.signal.aborted) return false

      if (!result.ok) {
        setReason(result.reason)
        return false
      }

      setSnapshot(result.snapshot)
      setReason(null)
      return true
    }

    // Read the key once and re-read it only when it changes: the credential
    // store is a synchronous SQLite lookup that must not run on every poll.
    async function loadCredential() {
      credential = await resolveCredential()
      await refresh(true)
    }

    // The palette command reports what happened instead of refreshing silently.
    async function refreshNow() {
      const refreshed = await refresh(true)
      if (refreshed) {
        context.ui.toast.show({ title: options.title, message: "usage refreshed", variant: "success" })
        return
      }

      const problem = reason()
      if (!problem) return
      const { label, hint } = REASON[problem]
      context.ui.toast.show({
        title: options.title,
        message: hint ? `${label} · ${hint}` : label,
        variant: "warning",
      })
    }

    // Integration metadata drives the "not configured" vs "key not readable"
    // distinction. The secret itself is never exposed by the plugin API.
    void (async () => {
      await context.data.location.integration.sync(context.location).catch(() => {})
      await loadCredential()
    })()

    const timer = setInterval(() => void refresh(), options.refreshIntervalMs)

    const stops = [
      context.data.on("session.usage.updated", () => void refresh()),
      context.data.on("session.execution.succeeded", () => void refresh()),
      context.data.on("session.created", () => void refresh()),
      // Unthrottled: the key or the connected integrations changed.
      context.data.on("credential.switched", () => void loadCredential()),
      context.data.on("credential.updated", () => void loadCredential()),
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
          run: () => void refreshNow(),
        },
      ],
    }))

    const disposeSlot = context.ui.slot({
      append: "sidebar.content",
      render: () => {
        const colors = paletteFor(context.theme, options.accent)
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
      inFlight = null
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
