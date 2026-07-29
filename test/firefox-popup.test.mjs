import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import vm from "node:vm"

const popupHtml = await fs.readFile(new URL("../firefox/popup.html", import.meta.url), "utf8")
const popupSource = await fs.readFile(new URL("../firefox/popup.js", import.meta.url), "utf8")

test("Firefox popup keeps the branded compact dark surface", () => {
  assert.match(popupHtml, /width: 220px/)
  assert.match(popupHtml, /#10141a/)
  assert.match(popupHtml, /#67df70/)
  assert.match(popupHtml, /font-family: Inter/)
  assert.match(popupHtml, /JetBrains Mono/)
  assert.match(popupHtml, /Quick start/)
  assert.match(popupHtml, /If direct delivery is unavailable, context is copied to your clipboard\./)
  assert.doesNotMatch(popupHtml, /cdn\.tailwindcss|fonts\.googleapis/)
})

test("Firefox popup exposes debug state and packaged version", async () => {
  const debugLabel = { textContent: "" }
  const debugButton = {
    querySelector() {
      return debugLabel
    },
    setAttribute(name, value) {
      this[name] = value
    },
    addEventListener(_type, listener) {
      this.listener = listener
    },
  }
  const copyButton = {
    addEventListener(_type, listener) {
      this.listener = listener
    },
  }
  const status = { textContent: "" }
  const version = { textContent: "" }
  let debugEnabled = false
  const messages = []
  const elements = new Map([
    ["#debug", debugButton],
    ["#copy", copyButton],
    ["#status", status],
    ["#version", version],
  ])

  vm.runInNewContext(popupSource, {
    document: { querySelector: selector => elements.get(selector) },
    browser: {
      runtime: {
        getManifest: () => ({ version: "1.8.7" }),
        async sendMessage(message) {
          messages.push(message)
          if (message.type === "get-debug-state") return { enabled: debugEnabled }
          if (message.type === "toggle-debug") {
            debugEnabled = !debugEnabled
            return { enabled: debugEnabled }
          }
          return { ok: true }
        },
      },
    },
  })

  await new Promise(resolve => setImmediate(resolve))
  assert.equal(version.textContent, "v1.8.7")
  assert.equal(debugLabel.textContent, "Enable debug logging")
  assert.equal(debugButton["aria-pressed"], "false")
  assert.equal(status.textContent, "> Debug logging is disabled.")

  await debugButton.listener()
  assert.equal(debugLabel.textContent, "Disable debug logging")
  assert.equal(debugButton["aria-pressed"], "true")
  assert.equal(status.textContent, "> Debug logging is enabled.")
  assert.deepEqual(messages.map(message => message.type), ["get-debug-state", "toggle-debug"])
})
