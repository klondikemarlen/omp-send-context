import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import { createEnvelope, isApplicationBlocked } from "#root/gnome-shell/context.js"

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
  "Main",
  "Extension",
  "createEnvelope",
  "isApplicationBlocked",
  "SelectionCapture",
  `${`${bridgeSource}\n${extensionSource}`
    .replace(/^import .*$/gm, "")
    .replace("export class", "class")
    .replace("export default class", "class")}\nreturn OmpSendContextExtension`
)

function createExtensionHarness(t) {
  const harness = {
    messages: [],
    notifications: [],
    application: "org.gnome.TextEditor.desktop",
    blocklist: [],
    selectionAccessed: false,
    bridgeRead: false,
    waitForSelection: false,
    waitForBridgeState: false,
  }
  const state = JSON.stringify({ endpoint: "http://127.0.0.1:47687", token: "test-token" })
  const previousDisplay = Object.getOwnPropertyDescriptor(global, "display")
  let focusChanged
  global.display = {
    focus_window: { get_pid: () => 123, get_title: () => "Selected document" },
    connect: (_signal, callback) => {
      focusChanged = callback
      return 1
    },
    disconnect: () => {},
  }
  harness.changeFocus = () => {
    const window = global.display.focus_window
    global.display.focus_window = null
    focusChanged()
    global.display.focus_window = window
    focusChanged()
  }

  const Gio = {
    _promisify: () => {},
    File: {
      new_for_path: () => ({
        load_contents_async: () => {
          harness.bridgeRead = true
          const result = [new TextEncoder().encode(state), null]
          if (!harness.waitForBridgeState) return Promise.resolve(result)
          return new Promise((resolve) => {
            harness.completeBridgeState = () => resolve(result)
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
          get_port: () => Number(endpoint.port),
        }
      },
    },
    build_filenamev: (parts) => parts.join("/"),
    get_home_dir: () => "/home/test",
  }
  const Meta = { KeyBindingFlags: { NONE: 0 } }
  const Shell = {
    ActionMode: { NORMAL: 0 },
    WindowTracker: {
      get_default: () => ({ get_window_app: () => ({ get_id: () => harness.application }) }),
    },
  }
  const Soup = {
    Message: {
      new: (_method, uri) => ({
        uri,
        status_code: 200,
        request_headers: { append: () => {} },
        set_request_body_from_bytes: (_contentType, body) => {
          harness.messages.push({ uri, body })
        },
      }),
    },
    Session: class {
      async send_and_read_async() {}
      abort() {}
    },
  }
  const Main = {
    wm: {
      addKeybinding: (_name, _settings, _flags, _modes, callback) => {
        harness.shortcut = callback
      },
      removeKeybinding: () => {},
    },
    notify: (_title, message) => harness.notifications.push(message),
  }
  class Extension {
    getSettings() {
      return { get_strv: () => harness.blocklist }
    }
  }
  class SelectionCapture {
    capture() {
      harness.selectionAccessed = true
      if (!harness.waitForSelection) return Promise.resolve("selected document text")
      return new Promise((resolve) => {
        harness.completeSelection = (text) => resolve(text)
      })
    }
    close() {}
  }
  const ExtensionClass = loadExtension(
    Gio,
    GLib,
    Meta,
    Shell,
    Soup,
    Main,
    Extension,
    createEnvelope,
    isApplicationBlocked,
    SelectionCapture
  )
  harness.extension = new ExtensionClass()
  t.after(() => {
    harness.extension.disable()
    if (previousDisplay) Object.defineProperty(global, "display", previousDisplay)
    else delete global.display
  })
  return harness
}

test("when a permitted application sends selected text, the generic handoff is delivered once", async (t) => {
  // Arrange
  const harness = createExtensionHarness(t)
  harness.extension.enable()

  // Act
  await harness.shortcut()

  // Assert
  assert.equal(harness.messages.length, 1)
  assert.equal(harness.messages[0].uri, "http://127.0.0.1:47687/context")
  const envelope = JSON.parse(new TextDecoder().decode(harness.messages[0].body))
  assert.equal(envelope.source, "gnome")
  assert.equal(envelope.metadata.application, "org.gnome.TextEditor.desktop")
  assert.match(envelope.prompt, /selected document text/)
})

test("when an application is blocked, neither selection nor OMP state is accessed", async (t) => {
  // Arrange
  const harness = createExtensionHarness(t)
  harness.application = "firefox_firefox.desktop"
  harness.blocklist = [harness.application]
  harness.extension.enable()

  // Act
  await harness.shortcut()

  // Assert
  assert.equal(harness.selectionAccessed, false)
  assert.equal(harness.bridgeRead, false)
  assert.deepEqual(harness.messages, [])
})

test("when a window has no canonical desktop identity, capture fails before accessing data", async (t) => {
  // Arrange
  const harness = createExtensionHarness(t)
  harness.application = "window:123"
  harness.extension.enable()

  // Act
  await harness.shortcut()

  // Assert
  assert.equal(harness.selectionAccessed, false)
  assert.equal(harness.bridgeRead, false)
})

test("when focus changes away and back during selection capture, stale text is not sent", async (t) => {
  // Arrange
  const harness = createExtensionHarness(t)
  harness.waitForSelection = true
  harness.extension.enable()
  const capture = harness.shortcut()

  // Act
  harness.changeFocus()
  harness.completeSelection("stale selection")
  await capture

  // Assert
  assert.deepEqual(harness.messages, [])
  assert.equal(harness.bridgeRead, false)
})

test("when focus changes while OMP state is loading, the captured text is not delivered", async (t) => {
  // Arrange
  const harness = createExtensionHarness(t)
  harness.waitForBridgeState = true
  harness.extension.enable()
  const capture = harness.shortcut()
  await new Promise((resolve) => setImmediate(resolve))

  // Act
  harness.changeFocus()
  harness.completeBridgeState()
  await capture

  // Assert
  assert.deepEqual(harness.messages, [])
})

test("when the shortcut is repeated during capture, only one handoff is delivered", async (t) => {
  // Arrange
  const harness = createExtensionHarness(t)
  harness.waitForSelection = true
  harness.extension.enable()
  const capture = harness.shortcut()

  // Act
  await harness.shortcut()
  harness.completeSelection("one selection")
  await capture

  // Assert
  assert.equal(harness.messages.length, 1)
  assert.match(
    JSON.parse(new TextDecoder().decode(harness.messages[0].body)).prompt,
    /one selection/
  )
})

test("when selection completes after re-enable, the old capture cannot affect the new session", async (t) => {
  // Arrange
  const harness = createExtensionHarness(t)
  harness.waitForSelection = true
  harness.extension.enable()
  const capture = harness.shortcut()

  // Act
  harness.extension.disable()
  harness.extension.enable()
  harness.completeSelection("late selection")
  await capture

  // Assert
  assert.deepEqual(harness.messages, [])
  assert.deepEqual(harness.notifications, [])
})

test("when OMP state arrives after re-enable, the old capture cannot send or notify", async (t) => {
  // Arrange
  const harness = createExtensionHarness(t)
  harness.waitForBridgeState = true
  harness.extension.enable()
  const capture = harness.shortcut()
  await new Promise((resolve) => setImmediate(resolve))

  // Act
  harness.extension.disable()
  harness.extension.enable()
  harness.completeBridgeState()
  await capture

  // Assert
  assert.deepEqual(harness.messages, [])
  assert.deepEqual(harness.notifications, [])
})
