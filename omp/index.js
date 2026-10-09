import { unwatchFile, watch, watchFile } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, basename, join } from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"

import { createBridgeRuntime } from "./bridge-runtime.js"

const PLUGIN_NAME = "omp-send-context"
const PLUGINS_LOCK_FILE = join(process.env.HOME ?? "", ".omp", "plugins", "omp-plugins.lock.json")
const PACKAGE_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json")
const DEFAULT_CLAIM_IDE_CONTEXT_ON_FOCUS = process.platform === "linux"

// Plugin reloads replace this module, but keep the process and terminal alive.
// Carry activity time across that boundary without inventing a new focus event.
const RELOAD_ACTIVITY_KEY = Symbol.for("omp-send-context.reload-activity")

let activeContext
let bridge
let focusUnsubscribe
let focusSettingsWatcher
let focusSettingsRefreshTimer
let pendingFocusInput = ""
let startupClaimedAt = 0
let pendingClaimedAt = 0
let focusSettingsGeneration = 0
let terminalFocusObserved = false

export default function ompSendContextExtension(pi) {
  const reloadActivity = globalThis[RELOAD_ACTIVITY_KEY]
  startupClaimedAt = reloadActivity?.home === process.env.HOME ? reloadActivity.claimedAt : 0
  delete globalThis[RELOAD_ACTIVITY_KEY]
  pi.setLabel("Send Context to OMP")

  pi.registerFlag("claim-ide-context-on-focus", {
    description: "On Linux, claim context when this terminal gains focus",
    type: "boolean",
    default: false,
  })

  pi.registerCommand("ide", {
    description: "Restore enabled autofocus; /ide status shows version and endpoint",
    getArgumentCompletions: (argumentPrefix) => {
      if (!"status".startsWith(argumentPrefix.toLowerCase())) {
        return null
      }
      return [
        {
          value: "status",
          label: "status",
          description: "Show this console's loaded plugin version and bridge endpoint",
        },
      ]
    },
    handler: async (args, ctx) => {
      const claimedAt = performance.timeOrigin + performance.now()
      activeContext = ctx
      await ensureServer()
      if (args.trim() === "status") {
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
    activeContext = ctx
    disableFocusClaiming()
    await refreshFocusClaiming(pi)
    await ensureServer()
    if (pendingClaimedAt > 0) {
      const claimedAt = pendingClaimedAt
      pendingClaimedAt = 0
      await claimCurrentConsole(claimedAt)
    } else {
      await bridge.claim()
    }
    watchFocusSettings(pi)
  })

  pi.on("session_before_switch", async (_event, ctx) => {
    activeContext = ctx
    // OMP has already cleared listeners; cancellation skips session_switch.
    await refreshFocusClaiming(pi, { rebind: true })
  })

  pi.on("session_switch", async (_event, ctx) => {
    const switchClaimedAt = performance.timeOrigin + performance.now()
    activeContext = ctx
    // OMP clears terminal-input listeners when creating a new session.
    disableFocusClaiming()
    await refreshFocusClaiming(pi)
    await ensureServer()
    const claimedAt = Math.max(switchClaimedAt, pendingClaimedAt)
    pendingClaimedAt = 0
    await claimCurrentConsole(claimedAt)
    watchFocusSettings(pi)
  })

  pi.on("session_shutdown", async () => {
    globalThis[RELOAD_ACTIVITY_KEY] = {
      home: process.env.HOME,
      claimedAt: bridge?.claimedAt ?? 0,
    }
    pendingClaimedAt = 0
    stopFocusSettingsWatcher()
    disableFocusClaiming()
    activeContext = undefined
    await closeServer()
  })
}

async function refreshFocusClaiming(pi, { rebind = false } = {}) {
  if (process.platform !== "linux" || activeContext === undefined) {
    return
  }

  const generation = ++focusSettingsGeneration
  const setting = await readFocusClaimingSetting()
  if (generation !== focusSettingsGeneration || activeContext === undefined) {
    return
  }
  const force = pi.getFlag("claim-ide-context-on-focus") === true
  if (force || setting === true) {
    if (rebind) {
      focusUnsubscribe?.()
      focusUnsubscribe = undefined
      pendingFocusInput = ""
    }
    enableFocusClaiming(activeContext, force)
  } else if (setting === false) {
    disableFocusClaiming()
  }
}

async function readFocusClaimingSetting() {
  try {
    const config = JSON.parse(await readFile(PLUGINS_LOCK_FILE, "utf8"))
    const setting = config.settings?.[PLUGIN_NAME]?.claimIdeContextOnFocus
    return setting === undefined ? DEFAULT_CLAIM_IDE_CONTEXT_ON_FOCUS : setting === true
  } catch (error) {
    return error?.code === "ENOENT" ? DEFAULT_CLAIM_IDE_CONTEXT_ON_FOCUS : undefined
  }
}

function watchFocusSettings(pi) {
  if (
    process.platform !== "linux" ||
    pi.getFlag("claim-ide-context-on-focus") === true ||
    focusSettingsWatcher !== undefined
  ) {
    return
  }

  const refresh = () => {
    clearTimeout(focusSettingsRefreshTimer)
    focusSettingsRefreshTimer = setTimeout(() => {
      void refreshFocusClaiming(pi)
    }, 25)
  }

  try {
    focusSettingsWatcher = watch(
      dirname(PLUGINS_LOCK_FILE),
      { persistent: false },
      (_event, filename) => {
        if (filename !== null && basename(filename.toString()) !== basename(PLUGINS_LOCK_FILE)) {
          return
        }
        refresh()
      }
    )
  } catch {
    watchFile(PLUGINS_LOCK_FILE, { persistent: false, interval: 100 }, refresh)
    focusSettingsWatcher = {
      close() {
        unwatchFile(PLUGINS_LOCK_FILE, refresh)
      },
    }
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
  process.stdout.write("\x1b[?1004h")
}

function disableFocusClaiming() {
  focusSettingsGeneration += 1
  pendingFocusInput = ""
  terminalFocusObserved = false
  if (focusUnsubscribe === undefined) {
    return
  }
  focusUnsubscribe()
  focusUnsubscribe = undefined
  process.stdout.write("\x1b[?1004l")
}

function handleFocusInput(data) {
  const input = `${pendingFocusInput}${data}`
  pendingFocusInput = input.match(/\x1b(?:\[)?$/)?.[0] ?? ""

  let focused = false
  const forwarded = input
    .slice(0, input.length - pendingFocusInput.length)
    .replace(/\x1b\[([IO])/g, (_report, state) => {
      // A first focus-out proves this console was already focused at startup.
      // Later focus-outs must not steal a console that just gained focus.
      if (state === "I" || !terminalFocusObserved) {
        focused = true
      }
      terminalFocusObserved = true
      return ""
    })

  if (focused || hasUserInput(forwarded)) {
    if (bridge?.endpoint === undefined) {
      pendingClaimedAt = performance.timeOrigin + performance.now()
    } else {
      void claimCurrentConsole().catch((error) => {
        activeContext?.ui.notify(
          `Could not select this context bridge: ${error.message}`,
          "warning"
        )
      })
    }
  }
  return forwarded.length > 0 ? { data: forwarded } : { consume: true }
}

function hasUserInput(input) {
  // Startup probes are terminal responses, not evidence of user activity.
  const withoutResponses = input
    .replace(/\x1b\[[0-9;:?=>$]*[Rcnty]/g, "")
    .replace(/\x1b\[\?[0-9;]*u/g, "")
    .replace(/\x1b(?:\]|P|_|^)[\s\S]*?(?:\x07|\x1b\\)/g, "")
  return withoutResponses.length > 0
}

async function ensureServer() {
  if (bridge === undefined) {
    bridge = createBridgeRuntime({
      deliverPrompt: pasteToPromptEditor,
      notify(message, level) {
        activeContext?.ui.notify(message, level)
      },
      packageFile: PACKAGE_FILE,
    })
  }
  await bridge.start({ claimedAt: startupClaimedAt })
  startupClaimedAt = 0
}

async function claimCurrentConsole(claimedAt = performance.timeOrigin + performance.now()) {
  return bridge?.claim({ force: true, claimedAt }) ?? false
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
  await bridge?.close()
  bridge = undefined
}
