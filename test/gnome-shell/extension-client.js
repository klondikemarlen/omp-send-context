import Gio from "gi://Gio"
import GLib from "gi://GLib"
import { OmpBridgeClient } from "../../gnome-shell/bridge.js"
import { createEnvelope, isPtyxisApplication } from "../../gnome-shell/context.js"

const action = ARGV[0]
const [, extensionSourceBytes] = GLib.file_get_contents(ARGV[1])
const extensionSource = new TextDecoder().decode(extensionSourceBytes)
const createExtension = Function(
  "global",
  "console",
  "Meta",
  "Shell",
  "St",
  "Main",
  "Extension",
  "OmpBridgeClient",
  "createEnvelope",
  "isPtyxisApplication",
  `${extensionSource
    .replace(/^import .*$/gm, "")
    .replace("export default class", "class")}\nreturn OmpSendContextExtension`
)

const notifications = []
const loggedErrors = []
const extensionConsole = {
  error: (...values) => loggedErrors.push(values.join(" ")),
}
let keybindingCallback
const Meta = { KeyBindingFlags: { NONE: 0 } }
const Shell = { ActionMode: { ALL: 0 } }
const St = {
  ClipboardType: { PRIMARY: "primary" },
  Clipboard: {
    get_default: () => ({
      get_text: (_type, callback) => callback(null, "selected terminal text"),
    }),
  },
}
const Main = {
  wm: {
    addKeybinding: (_name, _settings, _flags, _modes, callback) => {
      keybindingCallback = callback
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

const shellGlobal = {
  display: {
    focus_window: {
      get_gtk_application_id: () => "org.gnome.Ptyxis",
      get_title: () => "Project terminal",
    },
  },
}

const ExtensionClass = createExtension(
  shellGlobal,
  extensionConsole,
  Meta,
  Shell,
  St,
  Main,
  Extension,
  OmpBridgeClient,
  createEnvelope,
  isPtyxisApplication
)
const extension = new ExtensionClass()

try {
  extension.enable()
  const capture = keybindingCallback()

  if (action === "stale-read-failure") {
    await Promise.resolve()
    extension.disable()
    extension.enable()
  } else if (action === "stale-send-failure") {
    await waitForTeardownSignal()
    extension.disable()
    extension.enable()
  } else {
    throw new Error(`Unknown extension test action: ${action}`)
  }

  await capture
} finally {
  extension.disable()
}

print(JSON.stringify({ notifications, loggedErrors }))

async function waitForTeardownSignal() {
  Gio._promisify(Gio.InputStream.prototype, "read_bytes_async", "read_bytes_finish")
  const standardInput = Gio.UnixInputStream.new(0, false)
  await standardInput.read_bytes_async(1, GLib.PRIORITY_DEFAULT, null)
}
