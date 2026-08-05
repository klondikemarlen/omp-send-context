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
  `${`${bridgeSource}\n${extensionSource}`.replace(/^import .*$/gm, "").replace("export class", "class").replace("export default class", "class")}\nreturn OmpSendContextExtension`,
)

test("GNOME extension captures focused Ptyxis PRIMARY text and sends one envelope", async () => {
  const notifications = []
  const messages = []
  let shortcut
  let clipboardCallback
  const state = JSON.stringify({ endpoint: "http://127.0.0.1:47687", token: "test-token" })
  const window = {
    get_gtk_application_id: () => "org.gnome.Ptyxis",
    get_title: () => "Project terminal",
  }
  global.display = { focus_window: window }

  const Gio = {
    _promisify: () => {},
    File: {
      new_for_path: () => ({ load_contents_async: async () => [new TextEncoder().encode(state), null] }),
    },
  }
  const GLib = {
    Bytes: { new: (value) => value },
    PRIORITY_DEFAULT: 0,
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
        set_request_body_from_bytes: (_contentType, body) => { messages.push({ uri, body }) },
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
          callback(null, "selected terminal text")
        },
      }),
    },
  }
  const Main = {
    wm: {
      addKeybinding: (_name, _settings, _flags, _modes, callback) => { shortcut = callback },
      removeKeybinding: () => {},
    },
    notify: (_title, message) => notifications.push(message),
  }
  class Extension {
    getSettings() { return {} }
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
    isPtyxisApplication,
  )
  const extension = new ExtensionClass()
  extension.enable()
  shortcut()
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(messages.length, 1)
  assert.equal(messages[0].uri, "http://127.0.0.1:47687/context")
  assert.deepEqual(JSON.parse(new TextDecoder().decode(messages[0].body)), {
    version: 1,
    source: "ptyxis",
    prompt: "# OMP Agent Handoff\n\n## Ptyxis terminal\n\n- Application: org.gnome.Ptyxis\n\n- Window: Project terminal\n\n## Selected text\n\n```\nselected terminal text\n```\n\n",
    metadata: { application: "org.gnome.Ptyxis", title: "Project terminal" },
  })
  assert.deepEqual(notifications, ["Context sent to OMP."])
  extension.disable()
  clipboardCallback(null, "late selection")
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(messages.length, 1)
  assert.deepEqual(notifications, ["Context sent to OMP."])
})
