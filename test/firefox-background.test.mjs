import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import vm from "node:vm"

const backgroundSource = await fs.readFile(new URL("../firefox/background.js", import.meta.url), "utf8")

function event() {
  const listeners = []
  return {
    addListener(listener) {
      listeners.push(listener)
    },
    async emit(...args) {
      return Promise.all(listeners.map(listener => listener(...args)))
    },
  }
}

async function runFlow(nativeResponse, { pageUrl = "https://github.com/org/repo/pull/42/files", clipboardApi = true, clipboardExec = true } = {}) {
  const events = {
    installed: event(),
    menuClicked: event(),
    browserAction: event(),
    messages: event(),
    commands: event(),
  }
  const messages = []
  const notifications = []
  const indicator = { icon: null, badgeText: "", badgeColor: undefined, title: "" }
  const logs = []
  let clipboardText = ""
  let textarea
  const delivered = []
  let contentReady = false
  let injected = false
  const browser = {
    runtime: {
      onInstalled: events.installed,
      onMessage: events.messages,
      sendNativeMessage: async (_host, envelope) => {
        delivered.push(envelope)
        return nativeResponse
      },
      getManifest: () => ({ version: "1.7.1" }),
    },
    menus: {
      create() {},
      onClicked: events.menuClicked,
    },
    browserAction: {
      onClicked: events.browserAction,
      async setIcon({ path }) {
        indicator.icon = path
      },
      async setBadgeText({ text }) {
        indicator.badgeText = text
      },
      async setBadgeBackgroundColor({ color }) {
        indicator.badgeColor = color
      },
      async setTitle({ title }) {
        indicator.title = title
      },
    },
    commands: {
      onCommand: events.commands,
    },
    notifications: {
      async create(options) {
        notifications.push(options)
      },
    },
    tabs: {
      async query() {
        return [{ id: 42, url: pageUrl }]
      },
      async sendMessage(_tabId, message) {
        if (!contentReady) {
          throw new Error("No content script on this page")
        }
        messages.push(message)
        if (message.type === "capture-context") {
          return {
            selectionText: "const value = 1",
            pageUrl,
            title: pageUrl.includes("/pull/") ? "Test pull request" : "Test web page",
          }
        }
        return undefined
      },
      async executeScript() {
        injected = true
        contentReady = true
      },
    },
  }
  const navigator = {
    clipboard: {
      async writeText(text) {
        if (!clipboardApi) {
          throw new Error("Clipboard API unavailable")
        }
        clipboardText = text
      },
    },
  }
  const document = {
    body: { append() {} },
    createElement() {
      textarea = { style: {}, value: "", select() {}, remove() {} }
      return textarea
    },
    execCommand() {
      if (!clipboardExec) {
        return false
      }
      clipboardText = textarea.value
      return true
    },
  }


  vm.runInNewContext(backgroundSource, {
    navigator,
    document,
    browser,
    console: { info: (...args) => logs.push(args.join(" ")) },
    ompSendContext: {
      isSupportedGithubUrl: value => value.includes("/pull/"),
      isEligiblePageUrl: value => value.startsWith("http://") || value.startsWith("https://"),
      createEnvelope(capture) {
        return {
          prompt: `selected:${capture.selectionText}`,
          metadata: { url: capture.pageUrl, title: capture.title },
        }
      },
    },
    setTimeout,
    clearTimeout,
    Date,
  })

  await events.messages.emit({ type: "toggle-debug" })
  let error
  try {
    await events.commands.emit("send-context")
  } catch (caught) {
    error = caught
  }
  await new Promise(resolve => setTimeout(resolve, 10))
  return { messages, logs, notifications, indicator, events, clipboardText, error, injected, delivered }
}

test("Firefox client falls back when the native host rejects delivery", async () => {
  const result = await runFlow({ ok: false, error: "Invalid OMP bridge state" })

  assert.equal(result.clipboardText, "selected:const value = 1")
  assert.ok(result.messages.some(message => message.type === "notify" && message.message.includes("context copied to the clipboard")))
  assert.ok(result.logs.some(entry => entry.includes("native:failed:bridge-rejected")))
})

test("Firefox fallback copies the exact prompt when the Clipboard API succeeds", async () => {
  const result = await runFlow({ ok: false, error: "Invalid OMP bridge state" })

  assert.equal(result.clipboardText, "selected:const value = 1")
  assert.ok(result.logs.some(entry => entry.includes("clipboard:api-succeeded")))
})

test("Firefox fallback uses execCommand when the Clipboard API is unavailable", async () => {
  const result = await runFlow({ ok: false, error: "Invalid OMP bridge state" }, {
    clipboardApi: false,
  })

  assert.equal(result.clipboardText, "selected:const value = 1")
  assert.ok(result.logs.some(entry => entry.includes("clipboard:fallback-succeeded")))
})

test("Firefox fallback reports failure when clipboard writes fail", async () => {
  const result = await runFlow({ ok: false, error: "Invalid OMP bridge state" }, {
    clipboardApi: false,
    clipboardExec: false,
  })

  assert.ok(result.messages.some(message => message.type === "notify" && message.message.includes("Unable to deliver context to OMP or the clipboard.")))
  assert.equal(result.messages.some(message => message.type === "notify" && message.message.includes("context copied to the clipboard")), false)
  assert.ok(result.logs.some(entry => entry.includes("clipboard:api-failed")))
  assert.ok(result.logs.some(entry => entry.includes("clipboard:fallback-failed")))
  assert.ok(result.logs.some(entry => entry.includes("clipboard:failed")))
})

test("Firefox debug log records redacted native failures", async () => {
  const result = await runFlow(Promise.reject(new Error("Native host failed at /home/marlen/secret Authorization: Bearer abc123")))
  const detail = result.logs.find(entry => entry.includes("native:failure-detail:"))

  assert.match(detail, /native:failure-detail:Error: Native host failed at \[path\] \[redacted\]/)
  assert.equal(detail.includes("abc123"), false)
  assert.equal(detail.includes("/home/marlen"), false)
})

test("Firefox client does not fall back after native delivery succeeds", async () => {
  const result = await runFlow({ ok: true })

  assert.ok(result.logs.some(entry => entry.includes("native:succeeded")))
  assert.equal(result.messages.some(message => message.type === "copy-context"), false)
})

test("Firefox toolbar controls expose debug state and copy action", async () => {
  const result = await runFlow({ ok: true })
  const state = (await result.events.messages.emit({ type: "get-debug-state" }))[0]

  assert.equal(state.enabled, true)
  assert.equal(result.indicator.icon[48], "icons/icon-debug-48.png")
  assert.equal(result.indicator.badgeText, "!")

  const toggled = (await result.events.messages.emit({ type: "toggle-debug" }))[0]
  assert.equal(toggled.enabled, false)
  assert.equal(result.indicator.icon[48], "icons/icon-48.png")

  const copied = (await result.events.messages.emit({ type: "copy-debug-log" }))[0]
  assert.equal(copied.ok, true)
})

test("Firefox debug export reports clipboard failure accurately", async () => {
  const result = await runFlow({ ok: true }, {
    clipboardApi: false,
    clipboardExec: false,
  })

  const copied = (await result.events.messages.emit({ type: "copy-debug-log" }))[0]
  assert.equal(copied.ok, false)
  assert.equal(copied.message, "Debug log could not be copied.")
})

test("Firefox client captures generic web pages through activeTab injection", async () => {
  const result = await runFlow({ ok: true }, {
    pageUrl: "https://example.com/article",
  })

  assert.equal(result.injected, true)
  assert.ok(result.messages.some(message => message.type === "capture-context"))
  assert.ok(result.logs.some(entry => entry.includes("native:succeeded")))
})

test("Firefox client sends generic selected text from the context menu", async () => {
  const result = await runFlow({ ok: true }, {
    pageUrl: "https://example.com/article",
  })

  await result.events.menuClicked.emit({
    menuItemId: "omp-send-context",
    pageUrl: "https://example.com/article",
    selectionText: "menu selection",
  }, {
    id: 42,
    url: "https://example.com/article",
    title: "Test web page",
  })
  await new Promise(resolve => setTimeout(resolve, 10))

  assert.equal(result.delivered[1].prompt, "selected:menu selection")
  assert.deepEqual(result.delivered[1].metadata, {
    url: "https://example.com/article",
    title: "Test web page",
  })
})
test("Firefox client rejects unsupported shortcut pages", async () => {
  const result = await runFlow({ ok: true }, {
    pageUrl: "about:blank",
  })

  assert.equal(result.injected, false)
  assert.equal(result.messages.some(message => message.type === "capture-context"), false)
  assert.ok(result.notifications.some(notification => notification.message.includes("does not support web context")))
  assert.ok(result.logs.some(entry => entry.includes("shortcut:unsupported-page")))
})
