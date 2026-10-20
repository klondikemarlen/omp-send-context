import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createEnvelope, isPtyxisApplication } from "../gnome-shell/context.js"
const [bridgeSource, extensionSource] = await Promise.all([
  readFile(new URL("../gnome-shell/bridge.js", import.meta.url), "utf8"),
  readFile(new URL("../gnome-shell/extension.js", import.meta.url), "utf8"),
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

test("when capture completes after disable/re-enable, stale work is ignored", async () => {
  // Arrange
  const notifications = []
  const messages = []
  let shortcut
  let clipboardCallback
  let replyToClipboard = true
  let waitForBridgeStateRead = false
  let completeBridgeStateRead
  const state = JSON.stringify({ endpoint: "http://127.0.0.1:47687", token: "test-token" })
  const window = {
    get_gtk_application_id: () => "org.gnome.Ptyxis",
    get_title: () => "Project terminal",
  }
  global.display = { focus_window: window }

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

  // Act
  extension.enable()
  shortcut()
  await new Promise((resolve) => setImmediate(resolve))

  // Assert
  assert.equal(messages.length, 1)
  assert.equal(messages[0].uri, "http://127.0.0.1:47687/context")
  assert.equal(notifications.length, 1)
  replyToClipboard = false
  shortcut()
  const staleClipboardCallback = clipboardCallback
  extension.disable()
  extension.enable()
  staleClipboardCallback(null, "late selection")
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(messages.length, 1)
  assert.equal(notifications.length, 1)

  replyToClipboard = true
  waitForBridgeStateRead = true
  shortcut()
  await new Promise((resolve) => setImmediate(resolve))
  extension.disable()
  extension.enable()
  completeBridgeStateRead()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(messages.length, 1)
  assert.equal(notifications.length, 1)
  extension.disable()
})
