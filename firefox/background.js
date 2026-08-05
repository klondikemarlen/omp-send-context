const NATIVE_HOST_NAME = "omp_send_context"
const WEB_URL_PATTERNS = ["http://*/*", "https://*/*"]
const SOURCE_COMMIT = "uncommitted"
const MENU_ID = "omp-send-context"
const DEBUG_MENU_ID = "omp-send-context-debug"
const DEFAULT_ICON_PATHS = {
  48: "icons/icon-48.png",
  96: "icons/icon-96.png",
  128: "icons/icon-128.png",
}
const DEBUG_ICON_PATHS = {
  48: "icons/icon-debug-48.png",
  96: "icons/icon-debug-96.png",
  128: "icons/icon-debug-128.png",
}
const MAX_DEBUG_ENTRIES = 100

const debugEntries = []
let debugLogging = false
let debugIndicatorRevision = 0
void updateDebugIndicator()

browser.runtime.onInstalled.addListener(() => {
  browser.menus.create({
    id: MENU_ID,
    title: "Send selection and link to OMP",
    contexts: ["selection", "link"],
    documentUrlPatterns: WEB_URL_PATTERNS,
  })
  browser.menus.create({
    id: DEBUG_MENU_ID,
    title: "Copy OMP Send Context debug log",
    contexts: ["all"],
    documentUrlPatterns: WEB_URL_PATTERNS,
  })
})
browser.menus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === DEBUG_MENU_ID) {
    void copyDebugLog(tab?.id)
    return
  }
  if (info.menuItemId === MENU_ID) {
    void sendMenuContext(info, tab)
  }
})

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "debug-event" && typeof message.event === "string") {
    void recordDebug(`content:${message.event}`)
    return
  }
  if (message?.type === "get-debug-state") {
    return readDebugEnabled().then((enabled) => ({ enabled }))
  }
  if (message?.type === "toggle-debug") {
    return toggleDebugLogging().then((enabled) => ({ enabled }))
  }
  if (message?.type === "copy-debug-log") {
    return copyDebugLogActiveTab()
  }
})

browser.commands.onCommand.addListener((command) => {
  if (command !== "send-context") {
    return
  }
  void recordDebug("shortcut:received")
  void sendActiveContext()
})

async function sendMenuContext(info, tab) {
  await recordDebug("menu:received")
  try {
    const pageUrl = info.pageUrl ?? tab?.url ?? ""
    const envelope = ompSendContext.createEnvelope({
      selectionText: info.selectionText ?? "",
      linkUrl: info.linkUrl,
      pageUrl,
      title: tab?.title,
    })
    await recordDebug("envelope:created")
    await deliver(envelope, tab?.id)
  } catch (error) {
    await recordDebug("menu:failed")
    await notify(tab?.id, errorMessage(error))
  }
}

async function sendActiveContext() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (tab?.id === undefined) {
    await recordDebug("shortcut:no-active-tab")
    return
  }
  if (!ompSendContext.isEligiblePageUrl(tab.url ?? "")) {
    await recordDebug("shortcut:unsupported-page")
    await notify(
      tab.id,
      "Firefox blocks add-ons on this page, so OMP Send Context can’t copy context here."
    )
    return
  }

  try {
    await recordDebug("capture:requested")
    const capture = await captureTabContext(tab.id, tab.url ?? "")
    await recordDebug("capture:received")
    const envelope = ompSendContext.createEnvelope(capture)
    await recordDebug("envelope:created")
    await deliver(envelope, tab.id)
  } catch (error) {
    await recordDebug("shortcut:failed")
    await recordDebug(`shortcut:failure-detail:${nativeErrorDetail(error)}`)
    await notify(tab.id, errorMessage(error))
  }
}

async function captureTabContext(tabId, tabUrl) {
  await recordDebug(`capture:host-access:${await hostAccessStatus(tabUrl)}`)
  try {
    return await browser.tabs.sendMessage(tabId, { type: "capture-context" })
  } catch (error) {
    await recordDebug(`capture:message-failed:${nativeErrorDetail(error)}`)
    try {
      await browser.tabs.executeScript(tabId, { file: "context.js" })
      await browser.tabs.executeScript(tabId, { file: "content.js" })
    } catch (injectionError) {
      await recordDebug(`capture:inject-failed:${nativeErrorDetail(injectionError)}`)
      throw new Error("Page capture is not ready; reload the page and try again.")
    }
    return browser.tabs.sendMessage(tabId, { type: "capture-context" })
  }
}

async function hostAccessStatus(tabUrl) {
  if (!browser.permissions?.contains) {
    return "unknown"
  }
  try {
    const url = new URL(tabUrl)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "unsupported"
    }
    const granted = await browser.permissions.contains({ origins: [`${url.origin}/*`] })
    return granted ? "granted" : "missing"
  } catch {
    return "unknown"
  }
}

async function deliver(envelope, tabId) {
  await recordDebug("native:starting")
  try {
    const response = await browser.runtime.sendNativeMessage(NATIVE_HOST_NAME, envelope)
    if (response?.ok !== true) {
      throw new Error(response?.error ?? "Native host rejected the context.")
    }
    await recordDebug("native:succeeded")
    await notify(tabId, "Context sent to OMP.")
  } catch (error) {
    await recordDebug(`native:failed:${nativeErrorCode(error)}`)
    await recordDebug(`native:failure-detail:${nativeErrorDetail(error)}`)
    try {
      await recordDebug("clipboard:starting")
      await copyTextToClipboard(envelope.prompt)
      await recordDebug("clipboard:succeeded")
      await notify(tabId, "OMP host unavailable; context copied to the clipboard.")
    } catch {
      await recordDebug("clipboard:failed")
      throw new Error("Unable to deliver context to OMP or the clipboard.")
    }
  }
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    await recordDebug("clipboard:api-succeeded")
    return
  } catch {
    await recordDebug("clipboard:api-failed")
  }

  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  document.body.append(textarea)
  textarea.select()
  try {
    if (!document.execCommand("copy")) {
      throw new Error("Clipboard command returned false.")
    }
    await recordDebug("clipboard:fallback-succeeded")
  } catch {
    await recordDebug("clipboard:fallback-failed")
    throw new Error("Clipboard write failed.")
  } finally {
    textarea.remove()
  }
}

function nativeErrorCode(error) {
  const message = String(error?.message ?? "").toLowerCase()
  if (
    message.includes("no such native application") ||
    message.includes("not found") ||
    message.includes("native host")
  ) {
    return "host-unavailable"
  }
  if (message.includes("permission") || message.includes("access")) {
    return "host-permission"
  }
  if (message.includes("bridge") || message.includes("loopback")) {
    return "bridge-rejected"
  }
  return "unknown"
}

function nativeErrorDetail(error) {
  const name = String(error?.name ?? "Error")
    .replace(/\s+/g, " ")
    .trim()
  const message = String(error?.message ?? "")
    .replace(/\s+/g, " ")
    .trim()
  const safe = `${name}: ${message}`
    .replace(
      /\b(?:authorization\s*[:=]\s*(?:bearer\s+)?|bearer\s+|(?:token|secret|password)\s*[:=]\s*)\S+/gi,
      "[redacted]"
    )
    .replace(/(?:https?|file):\/\/\S+/gi, "[url]")
    .replace(/(?:[A-Za-z]:)?\/[^\s]+/g, "[path]")
  return safe.slice(0, 160) || "no-message"
}

async function updateDebugIndicator(enabled) {
  const revision = ++debugIndicatorRevision
  const currentEnabled = enabled ?? (await readDebugEnabled())
  if (revision !== debugIndicatorRevision) {
    return
  }
  await browser.browserAction.setIcon({
    path: currentEnabled ? DEBUG_ICON_PATHS : DEFAULT_ICON_PATHS,
  })
  await browser.browserAction.setBadgeText({ text: currentEnabled ? "!" : "" })
  await browser.browserAction.setBadgeBackgroundColor({
    color: currentEnabled ? "#d1242f" : "#57606a",
  })
  await browser.browserAction.setTitle({
    title: currentEnabled
      ? "OMP Send Context; debug logging is ON"
      : "OMP Send Context; debug logging is OFF",
  })
}

async function toggleDebugLogging() {
  const enabled = await readDebugEnabled()
  const nextEnabled = !enabled
  debugLogging = nextEnabled
  debugEntries.length = 0
  await updateDebugIndicator(nextEnabled)
  await recordDebug(nextEnabled ? "debug:enabled" : "debug:disabled")
  await notifyActiveTab(`Debug logging ${nextEnabled ? "enabled" : "disabled"}.`)
  return nextEnabled
}

async function copyDebugLog(tabId) {
  const report = [
    "OMP Send Context debug log",
    `Extension version: ${browser.runtime.getManifest().version}`,
    `Source commit: ${SOURCE_COMMIT}`,
    `Debug logging: ${(await readDebugEnabled()) ? "enabled" : "disabled"}`,
    ...debugEntries,
  ].join("\n")
  try {
    await copyTextToClipboard(report)
    await notify(tabId, "Debug log copied to the clipboard.")
    return true
  } catch {
    await recordDebug("debug-export:failed")
    return false
  }
}

async function copyDebugLogActiveTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (tab?.id === undefined) {
    return { ok: false, message: "No active tab." }
  }
  const ok = await copyDebugLog(tab.id)
  return { ok, message: ok ? undefined : "Debug log could not be copied." }
}

async function notifyActiveTab(message) {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  await notify(tab?.id, message)
}

async function notify(tabId, message) {
  if (tabId === undefined) {
    return
  }
  try {
    await browser.tabs.sendMessage(tabId, { type: "notify", message })
  } catch {
    try {
      await browser.notifications.create({
        type: "basic",
        title: "OMP Send Context",
        message,
      })
    } catch {
      await recordDebug("notify:failed")
    }
  }
}

async function readDebugEnabled() {
  return debugLogging
}

async function recordDebug(event) {
  if (!(await readDebugEnabled())) {
    return
  }
  const entry = `${new Date().toISOString()} ${event}`
  debugEntries.push(entry)
  if (debugEntries.length > MAX_DEBUG_ENTRIES) {
    debugEntries.shift()
  }
  console.info(`[OMP Send Context] ${entry}`)
}

function errorMessage(error) {
  return error instanceof Error ? error.message : "Unable to send context to OMP."
}
