import { unwatchFile, watchFile } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { createBridgeRuntime } from "./bridge-runtime.js"
import { classifyTerminalActivity } from "./terminal-activity.js"
import { createRoutingDiagnostics } from "./routing-diagnostics.js"

const PLUGIN_NAME = "omp-send-context"
const PLUGINS_LOCK_FILE = join(process.env.HOME ?? "", ".omp", "plugins", "omp-plugins.lock.json")
const PACKAGE_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json")
const DEFAULT_CLAIM_IDE_CONTEXT_ON_FOCUS = process.platform === "linux"

// Plugin reloads replace this module, but keep the process and terminal alive.
// Carry activity time across that boundary without inventing a new focus event.
const RELOAD_ACTIVITY_KEY = Symbol.for("omp-send-context.reload-activity")

export default function ompSendContextExtension(pi) {
  let activeContext
  let bridge
  let focusUnsubscribe
  let focusSettingsWatcher
  let focusSettingsRefreshTimer
  let startupClaimedAt = 0
  let pendingClaimedAt = 0
  let focusSettingsGeneration = 0
  let routingDiagnostics
  let observedFocusSetting
  let observedDiagnosticsSetting

  pi.setLabel("Send Context to OMP")

  pi.registerFlag("claim-ide-context-on-focus", {
    description: "On Linux, claim context when this terminal gains focus",
    type: "boolean",
    default: false,
  })

  pi.registerCommand("ide", {
    description: "Restore enabled autofocus; /ide status shows version and endpoint",
    getArgumentCompletions: (argumentPrefix) => {
      const choices = [
        ["status", "Show this console's loaded plugin version and bridge endpoint"],
        ["diagnostics", "Show this console's passive routing diagnostic status"],
      ]
      const matchingChoices = choices
        .filter(([value]) => value.startsWith(argumentPrefix.toLowerCase()))
        .map(([value, description]) => ({ value, label: value, description }))
      return matchingChoices.length === 0 ? null : matchingChoices
    },
    handler: async (args, ctx) => {
      if (!ctx.hasUI && ctx.agent?.kind === "sub") {
        return
      }
      const argument = args.trim()
      if (argument === "diagnostics") {
        const status = routingDiagnostics?.enabled ? "enabled" : "disabled"
        const logPath = routingDiagnostics?.path ?? "not created"
        ctx.ui.notify(
          `Routing diagnostics are ${status}; PID ${process.pid}; log: ${logPath}.`,
          "info"
        )
        return
      }
      const claimedAt = Date.now()
      activeContext = ctx
      await ensureServer()
      if (argument === "status") {
        ctx.ui.notify(
          `Send Context to OMP ${bridge.version} is listening on ${bridge.endpoint}.`,
          "info"
        )
        return
      }
      await refreshFocusClaiming(pi, { rebind: true })
      if (await claimCurrentConsole(claimedAt)) {
        const autofocusNotice =
          focusUnsubscribe === undefined
            ? ""
            : " Autofocus restored; future console activity can change the target."
        ctx.ui.notify(
          `Context will target this terminal via ${bridge.endpoint}.${autofocusNotice}`,
          "info"
        )
      }
    },
  })

  pi.on("session_start", async (_event, ctx) => {
    await connectSession(pi, ctx, "session_start")
  })

  pi.on("session_switch", async (_event, ctx) => {
    await connectSession(pi, ctx, "session_switch")
  })

  pi.on("session_shutdown", async (_event, ctx) => {
    if ((!ctx?.hasUI && ctx?.agent?.kind === "sub") || activeContext === undefined) {
      return
    }
    routingDiagnostics?.record("session_shutdown")
    if (activeContext.hasUI) {
      globalThis[RELOAD_ACTIVITY_KEY] = {
        home: process.env.HOME,
        sessionId: activeContext.sessionManager?.getSessionId?.(),
        claimedAt: bridge?.claimedAt ?? 0,
      }
    }
    pendingClaimedAt = 0
    stopFocusSettingsWatcher()
    disableFocusClaiming()
    activeContext = undefined
    await closeServer()
    await routingDiagnostics?.close()
    routingDiagnostics = undefined
  })

  async function connectSession(pi, ctx, event) {
    if (!ctx.hasUI && ctx.agent?.kind === "sub") {
      return
    }
    if (activeContext === undefined && ctx.hasUI) {
      const reloadActivity = globalThis[RELOAD_ACTIVITY_KEY]
      if (
        reloadActivity?.home === process.env.HOME &&
        reloadActivity.sessionId === ctx.sessionManager?.getSessionId?.()
      ) {
        startupClaimedAt = reloadActivity.claimedAt
        delete globalThis[RELOAD_ACTIVITY_KEY]
      }
    }
    activeContext = ctx
    if (!ctx.hasUI) {
      await ensureServer()
      await claimBridge()
      return
    }
    routingDiagnostics ??= createRoutingDiagnostics({
      getSnapshot: () => ({
        version: bridge?.version,
        instanceId: bridge?.instanceId,
        endpoint: bridge?.endpoint,
        claimedAt: bridge?.claimedAt,
        hasUI: activeContext?.hasUI,
        focusSubscriptionRegistered: focusUnsubscribe !== undefined,
        stdinGuardPresent: process.stdin.listeners("data").includes(restoreFocusInputSubscription),
        sessionId: activeContext?.sessionManager?.getSessionId?.(),
        agentKind: activeContext?.agent?.kind,
        mode: activeContext?.mode,
      }),
    })
    startPluginSettingsWatcher(pi)
    disableFocusClaiming()
    await refreshPluginSettings(pi)
    routingDiagnostics.record(event)
    await refreshFocusClaiming(pi)
    await ensureServer()
    if (pendingClaimedAt > 0) {
      const claimedAt = pendingClaimedAt
      pendingClaimedAt = 0
      await claimCurrentConsole(claimedAt)
    } else {
      await claimBridge()
    }
  }

  async function refreshFocusClaiming(pi, { rebind = false } = {}) {
    if (process.platform !== "linux" || activeContext === undefined) {
      return
    }

    const generation = ++focusSettingsGeneration
    const settings = await readPluginSettings()
    const setting = settings?.focus
    if (generation !== focusSettingsGeneration || activeContext === undefined) {
      return
    }
    const force = pi.getFlag("claim-ide-context-on-focus") === true
    if (force || setting === true) {
      if (rebind) {
        focusUnsubscribe?.()
        focusUnsubscribe = undefined
      }
      enableFocusClaiming(activeContext, force)
    } else if (setting === false) {
      disableFocusClaiming()
    }
  }

  async function readPluginSettings() {
    try {
      const config = JSON.parse(await readFile(PLUGINS_LOCK_FILE, "utf8"))
      const settings = config.settings?.[PLUGIN_NAME] ?? {}
      return {
        focus:
          settings.claimIdeContextOnFocus === undefined
            ? DEFAULT_CLAIM_IDE_CONTEXT_ON_FOCUS
            : settings.claimIdeContextOnFocus === true,
        diagnostics: settings.diagnostics === true,
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        return undefined
      }
      return { focus: DEFAULT_CLAIM_IDE_CONTEXT_ON_FOCUS, diagnostics: false }
    }
  }

  async function refreshPluginSettings(pi) {
    const settings = await readPluginSettings()
    if (settings === undefined || activeContext?.hasUI !== true) {
      return
    }
    const focusChanged = observedFocusSetting !== settings.focus
    const diagnosticsChanged = observedDiagnosticsSetting !== settings.diagnostics
    observedFocusSetting = settings.focus
    observedDiagnosticsSetting = settings.diagnostics
    if (diagnosticsChanged) {
      routingDiagnostics?.record("settings_changed")
      await routingDiagnostics?.setEnabled(settings.diagnostics)
    }
    if (
      focusChanged &&
      process.platform === "linux" &&
      pi.getFlag("claim-ide-context-on-focus") !== true
    ) {
      await refreshFocusClaiming(pi)
    }
  }

  function startPluginSettingsWatcher(pi) {
    if (focusSettingsWatcher !== undefined) {
      return
    }
    const refresh = () => {
      clearTimeout(focusSettingsRefreshTimer)
      focusSettingsRefreshTimer = setTimeout(() => {
        void refreshPluginSettings(pi)
      }, 25)
    }
    watchFile(PLUGINS_LOCK_FILE, { persistent: false, interval: 100 }, refresh)
    focusSettingsWatcher = {
      close() {
        unwatchFile(PLUGINS_LOCK_FILE, refresh)
      },
    }
  }

  function stopFocusSettingsWatcher() {
    focusSettingsWatcher?.close()
    focusSettingsWatcher = undefined
    clearTimeout(focusSettingsRefreshTimer)
    focusSettingsRefreshTimer = undefined
  }

  function enableFocusClaiming(ctx, force = false) {
    if (process.platform !== "linux" || !ctx.hasUI || focusUnsubscribe !== undefined) {
      return
    }

    if (typeof ctx.ui?.onTerminalInput !== "function") {
      if (force) {
        ctx.ui.notify("Claim IDE context on focus requires OMP 16.5.1 or newer.", "warning")
      }
      return
    }

    focusUnsubscribe = ctx.ui.onTerminalInput(handleFocusInput)
    routingDiagnostics?.record("input_guard")
    // OMP can clear its listeners without delivering any of our session hooks.
    // Rearm before its stdin handler runs; parsing and claiming stay on the UI path.
    process.stdin.removeListener("data", restoreFocusInputSubscription)
    process.stdin.prependListener("data", restoreFocusInputSubscription)
    process.stdout.write("\x1b[?1004h")
  }

  function restoreFocusInputSubscription() {
    focusUnsubscribe?.()
    focusUnsubscribe = activeContext.ui.onTerminalInput(handleFocusInput)
  }

  function disableFocusClaiming() {
    focusSettingsGeneration += 1
    process.stdin.removeListener("data", restoreFocusInputSubscription)
    if (focusUnsubscribe === undefined) {
      return
    }
    focusUnsubscribe()
    focusUnsubscribe = undefined
    process.stdout.write("\x1b[?1004l")
  }

  function handleFocusInput(data) {
    const activity = classifyTerminalActivity(data)
    routingDiagnostics?.observeInput(
      data === "\x1b[I"
        ? "focus-in"
        : data === "\x1b[O"
          ? "focus-out"
          : activity.hasActivity
            ? "keyboard"
            : "terminal-report"
    )
    if (activity.hasActivity) {
      if (bridge?.endpoint === undefined) {
        pendingClaimedAt = Date.now()
      } else {
        void claimCurrentConsole().catch((error) => {
          activeContext?.ui.notify(
            `Could not select this context bridge: ${error.message}`,
            "warning"
          )
        })
      }
    }
    return activity.data.length > 0 ? { data: activity.data } : { consume: true }
  }

  async function ensureServer() {
    if (bridge === undefined) {
      bridge = createBridgeRuntime({
        deliverPrompt: async (prompt) => {
          try {
            await pasteToPromptEditor(prompt)
            routingDiagnostics?.record("delivery")
          } catch (error) {
            routingDiagnostics?.record("delivery_failed", { errorCode: error?.code })
            throw error
          }
        },
        notify(message, level) {
          activeContext?.ui.notify(message, level)
        },
        packageFile: PACKAGE_FILE,
      })
    }
    const starting = bridge.endpoint === undefined
    try {
      await bridge.start({ claimedAt: startupClaimedAt })
      startupClaimedAt = 0
      if (starting) {
        routingDiagnostics?.record("bridge_started")
      }
    } catch (error) {
      routingDiagnostics?.record("bridge_start_failed", { errorCode: error?.code })
      throw error
    }
  }

  async function claimCurrentConsole(claimedAt = Date.now()) {
    routingDiagnostics?.record("claim_requested")
    const claimed = await (bridge?.claim({ force: true, claimedAt }) ?? false)
    routingDiagnostics?.record("claim_completed")
    return claimed
  }

  async function claimBridge() {
    routingDiagnostics?.record("claim_requested")
    const claimed = await bridge?.claim()
    routingDiagnostics?.record("claim_completed")
    return claimed
  }

  async function pasteToPromptEditor(prompt) {
    if (!activeContext?.hasUI) {
      throw new Error("No active OMP prompt editor available")
    }

    const ui = activeContext.ui
    if (typeof ui?.pasteToEditor === "function") {
      await ui.pasteToEditor(prompt)
      if (!prompt.endsWith(" ")) {
        await ui.pasteToEditor(" ")
      }
      return
    }
    if (typeof ui?.setEditorText !== "function") {
      throw new Error("No active OMP prompt editor available")
    }

    const beforePasteText = typeof ui.getEditorText === "function" ? await ui.getEditorText() : ""
    await ui.setEditorText(`${beforePasteText}${prompt.endsWith(" ") ? prompt : `${prompt} `}`)
  }

  async function closeServer() {
    if (bridge !== undefined) {
      await bridge.close()
      routingDiagnostics?.record("bridge_closed")
    }
    bridge = undefined
  }
}
