import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import { createEnvelope, isPtyxisApplication } from "#root/gnome-shell/context.js"

const [bridgeSource, extensionSource] = await Promise.all([
  readFile(new URL(import.meta.resolve("#root/gnome-shell/bridge.js")), "utf8"),
  readFile(new URL(import.meta.resolve("#root/gnome-shell/extension.js")), "utf8"),
])

const loadExtension = Function(
  "Gio",
  "GLib",
  "Meta",
  "Shell",
  "Soup",
  "St",
  "Main",
  "Extension",
  "createEnvelope",
  "isPtyxisApplication",
  `${`${bridgeSource}\n${extensionSource}`
    .replace(/^import .*$/gm, "")
    .replace("export class", "class")
    .replace("export default class", "class")}\nreturn OmpSendContextExtension`
)

function createExtensionHarness(t) {
  // Arrange
  const notifications = []
  const messages = []
  let shortcut
  let clipboardCallback
  let replyToClipboard = true
  let waitForBridgeStateRead = false
  let completeBridgeStateRead
  const state = JSON.stringify({ endpoint: "http://127.0.0.1:47687", token: "test-token" })
  const previousDisplay = Object.getOwnPropertyDescriptor(global, "display")

  global.display = {
    focus_window: {
      get_gtk_application_id: () => "org.gnome.Ptyxis",
      get_title: () => "Project terminal",
    },
  }

  const Gio = {
    _promisify: () => {},
    File: {
      new_for_path: () => ({
        load_contents_async: () => {
          if (!waitForBridgeStateRead) {
            return Promise.resolve([new TextEncoder().encode(state), null])
          }

          return new Promise((resolve) => {
            completeBridgeStateRead = () => resolve([new TextEncoder().encode(state), null])
          })
        },
      }),
    },
  }
  const GLib = {
    Bytes: { new: (value) => value },
    PRIORITY_DEFAULT: 0,
    UriFlags: { NONE: 0 },
    Uri: {
      parse: (value) => {
        const endpoint = new URL(value)
        return {
          get_scheme: () => endpoint.protocol.slice(0, -1),
          get_host: () => endpoint.hostname,
          get_port: () => (endpoint.port ? Number(endpoint.port) : -1),
        }
      },
    },
    build_filenamev: (parts) => parts.join("/"),
    get_home_dir: () => "/home/test",
  }
  const Meta = { KeyBindingFlags: { NONE: 0 } }
  const Shell = { ActionMode: { ALL: 0 } }
  const Soup = {
    Message: {
      new: (_method, uri) => ({
        uri,
        status_code: 200,
        request_headers: { append: () => {} },
        set_request_body_from_bytes: (_contentType, body) => {
          messages.push({ uri, body })
        },
      }),
    },
    Session: class {
      async send_and_read_async() {}
      abort() {}
    },
  }
  const St = {
    ClipboardType: { PRIMARY: "primary" },
    Clipboard: {
      get_default: () => ({
        get_text: (_type, callback) => {
          clipboardCallback = callback
          if (replyToClipboard) {
            callback(null, "selected terminal text")
          }
        },
      }),
    },
  }
  const Main = {
    wm: {
      addKeybinding: (_name, _settings, _flags, _modes, callback) => {
        shortcut = callback
      },
      removeKeybinding: () => {},
    },
    notify: (_title, message) => notifications.push(message),
  }
  class Extension {
    getSettings() {
      return {}
    }
  }

  const ExtensionClass = loadExtension(
    Gio,
    GLib,
    Meta,
    Shell,
    Soup,
    St,
    Main,
    Extension,
    createEnvelope,
    isPtyxisApplication
  )
  const extension = new ExtensionClass()

  t.after(() => {
    extension.disable()
    if (previousDisplay) {
      Object.defineProperty(global, "display", previousDisplay)
    } else {
      delete global.display
    }
  })

  return {
    extension,
    messages,
    notifications,
    get shortcut() {
      return shortcut
    },
    get clipboardCallback() {
      return clipboardCallback
    },
    set replyToClipboard(value) {
      replyToClipboard = value
    },
    set waitForBridgeStateRead(value) {
      waitForBridgeStateRead = value
    },
    get completeBridgeStateRead() {
      return completeBridgeStateRead
    },
  }
}

test("when enabled and a Ptyxis selection is sent, the bridge receives it", async (t) => {
  // Arrange
  const harness = createExtensionHarness(t)

  // Act
  harness.extension.enable()
  harness.shortcut()
  await new Promise((resolve) => setImmediate(resolve))

  // Assert
  assert.equal(harness.messages.length, 1)
  assert.equal(harness.messages[0].uri, "http://127.0.0.1:47687/context")
  assert.equal(harness.notifications.length, 1)
})

test("when clipboard selection arrives after disable and re-enable, stale work is ignored", async (t) => {
  // Arrange
  const harness = createExtensionHarness(t)
  harness.extension.enable()
  harness.replyToClipboard = false
  harness.shortcut()
  const staleClipboardCallback = harness.clipboardCallback

  // Act
  harness.extension.disable()
  harness.extension.enable()
  staleClipboardCallback(null, "late selection")
  await new Promise((resolve) => setImmediate(resolve))

  // Assert
  assert.equal(harness.messages.length, 0)
  assert.deepEqual(harness.notifications, [])
})

test("when bridge state arrives after disable and re-enable, stale work is ignored", async (t) => {
  // Arrange
  const harness = createExtensionHarness(t)
  harness.extension.enable()
  harness.waitForBridgeStateRead = true
  harness.shortcut()
  await new Promise((resolve) => setImmediate(resolve))

  // Act
  harness.extension.disable()
  harness.extension.enable()
  harness.completeBridgeStateRead()
  await new Promise((resolve) => setImmediate(resolve))

  // Assert
  assert.equal(harness.messages.length, 0)
  assert.deepEqual(harness.notifications, [])
})
