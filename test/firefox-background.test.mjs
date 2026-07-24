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

async function runFlow(nativeResponse, { pageUrl = "https://github.com/org/repo/pull/42/files" } = {}) {
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
  let debugLogging = false
  const browser = {
    runtime: {
      onInstalled: events.installed,
      onMessage: events.messages,
      sendNativeMessage: async () => nativeResponse,
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
    storage: {
      local: {
        async get() {
          return { debugLogging }
        },
        async set(values) {
          debugLogging = values.debugLogging
        },
      },
    },
    tabs: {
      async query() {
        return [{ id: 42, url: pageUrl }]
      },
      async sendMessage(_tabId, message) {
        if (message.type === "notify" && !pageUrl.includes("/pull/")) {
          throw new Error("No content script on this page")
        }
        messages.push(message)
        if (message.type === "capture-context") {
          return {
            selectionText: "const value = 1",
            pageUrl,
            title: "Test pull request",
          }
        }
        return undefined
      },
    },
  }

  vm.runInNewContext(backgroundSource, {
    browser,
    console: { info: (...args) => logs.push(args.join(" ")) },
    ompSendContext: {
      isSupportedGithubUrl: value => value.includes("/pull/"),
      createEnvelope(capture) {
        return { prompt: `selected:${capture.selectionText}` }
      },
    },
    setTimeout,
    clearTimeout,
    Date,
  })

  await events.messages.emit({ type: "toggle-debug" })
  await events.commands.emit("send-context")
  await new Promise(resolve => setTimeout(resolve, 10))
  return { messages, logs, notifications, indicator, events }
}

test("Firefox client falls back when the native host rejects delivery", async () => {
  const result = await runFlow({ ok: false, error: "Invalid OMP bridge state" })

  assert.ok(result.messages.some(message => message.type === "copy-context"))
  assert.ok(result.logs.some(entry => entry.includes("native:failed:bridge-rejected")))
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

test("Firefox client ignores non-pull-request pages", async () => {
  const result = await runFlow({ ok: true }, {
    pageUrl: "https://github.com/org/repo/issues/42",
  })

  assert.equal(result.messages.some(message => message.type === "capture-context"), false)
  assert.ok(result.notifications.some(notification => notification.message.includes("not a supported GitHub pull request")))
  assert.ok(result.logs.some(entry => entry.includes("shortcut:unsupported-page")))
})
