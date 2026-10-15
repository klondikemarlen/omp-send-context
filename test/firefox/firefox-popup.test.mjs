import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import vm from "node:vm"

const popupSource = await fs.readFile(new URL("../../firefox/popup.js", import.meta.url), "utf8")

test("when the user toggles debug logging, the popup updates its pressed state", async () => {
  // Arrange
  const debugButton = {
    querySelector: () => ({ textContent: "" }),
    setAttribute(name, value) {
      this[name] = value
    },
    addEventListener(_type, listener) {
      this.listener = listener
    },
  }
  const copyButton = { addEventListener() {} }
  const status = { textContent: "" }
  const version = { textContent: "" }
  let debugEnabled = false
  const elements = new Map([
    ["#debug", debugButton],
    ["#copy", copyButton],
    ["#status", status],
    ["#version", version],
  ])

  vm.runInNewContext(popupSource, {
    document: { querySelector: (selector) => elements.get(selector) },
    browser: {
      runtime: {
        getManifest: () => ({ version: "1.8.7" }),
        async sendMessage(message) {
          if (message.type === "get-debug-state") {
            return { enabled: debugEnabled }
          }

          if (message.type === "toggle-debug") {
            debugEnabled = !debugEnabled
            return { enabled: debugEnabled }
          }
          return { ok: true }
        },
      },
    },
  })

  await new Promise((resolve) => setImmediate(resolve))
  const initialPressed = debugButton["aria-pressed"]

  // Act
  await debugButton.listener()

  // Assert
  assert.equal(initialPressed, "false")
  assert.equal(debugButton["aria-pressed"], "true")
})

test("when the popup opens, it displays the installed add-on version", () => {
  // Arrange
  const version = { textContent: "" }
  const button = {
    addEventListener() {},
    querySelector: () => ({ textContent: "" }),
    setAttribute() {},
  }
  const elements = new Map([
    ["#debug", button],
    ["#copy", button],
    ["#status", { textContent: "" }],
    ["#version", version],
  ])

  // Act
  vm.runInNewContext(popupSource, {
    document: { querySelector: (selector) => elements.get(selector) },
    browser: {
      runtime: {
        getManifest: () => ({ version: "1.8.7" }),
        async sendMessage() {
          return { enabled: false }
        },
      },
    },
  })

  // Assert
  assert.equal(version.textContent, "v1.8.7")
})
