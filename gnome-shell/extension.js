import Gio from "gi://Gio"
import GLib from "gi://GLib"
import Meta from "gi://Meta"
import Shell from "gi://Shell"
import Soup from "gi://Soup?version=3.0"
import St from "gi://St"
import Main from "resource:///org/gnome/shell/ui/main.js"
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js"

import { createEnvelope, isPtyxisApplication } from "./context.js"

const STATE_FILE = [".omp", "agent", "editor-context-bridge.json"]
const HOST = "127.0.0.1"

export default class OmpSendContextExtension extends Extension {
  enable() {
    this.settings = this.getSettings()
    this._onShortcut = () => this._captureSelection()
    Main.wm.addKeybinding(
      "desktop-shortcut",
      this.settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.ALL,
      this._onShortcut,
    )
  }

  disable() {
    Main.wm.removeKeybinding("desktop-shortcut")
    this._onShortcut = null
    this.settings = null
  }

  _captureSelection() {
    const window = global.display.focus_window
    const application = window?.get_gtk_application_id?.() || window?.get_wm_class?.() || "unknown application"
    if (!isPtyxisApplication(application)) {
      Main.notify("OMP Send Context", "Focus a Ptyxis terminal to send terminal context.")
      return
    }

    const title = window?.get_title?.() || "untitled window"
    St.Clipboard.get_default().get_text(St.ClipboardType.PRIMARY, (_clipboard, text) => {
      if (!text || text.trim().length === 0) {
        Main.notify("OMP Send Context", "No selected text in the focused application.")
        return
      }
      try {
        this._send(createEnvelope({ selectionText: text, application, windowTitle: title }))
      } catch (error) {
        Main.notify("OMP Send Context", error.message)
      }
    })
  }

  _send(envelope) {
    let state
    try {
      state = this._readState()
    } catch (error) {
      Main.notify("OMP Send Context", error.message)
      return
    }

    const session = new Soup.Session()
    const message = Soup.Message.new("POST", `${state.endpoint}/context`)
    message.request_headers.append("Content-Type", "application/json")
    message.request_headers.append("Authorization", `Bearer ${state.token}`)
    const payload = new TextEncoder().encode(JSON.stringify(envelope))
    message.set_request_body_from_bytes("application/json", GLib.Bytes.new(payload))
    session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (_session, result) => {
      try {
        session.send_and_read_finish(result)
        if (message.status_code < 200 || message.status_code >= 300) {
          throw new Error(`OMP bridge returned ${message.status_code}`)
        }
        Main.notify("OMP Send Context", "Context sent to OMP.")
      } catch (error) {
        Main.notify("OMP Send Context", `Unable to send context: ${error.message}`)
      }
    })
  }

  _readState() {
    const path = GLib.build_filenamev([GLib.get_home_dir(), ...STATE_FILE])
    let contents
    try {
      [, contents] = Gio.File.new_for_path(path).load_contents(null)
    } catch {
      throw new Error("No active OMP session was found.")
    }

    let state
    try {
      state = JSON.parse(new TextDecoder().decode(contents))
    } catch {
      throw new Error("The active OMP session state is invalid.")
    }
    const endpoint = new URL(state.endpoint)
    if (endpoint.protocol !== "http:" || endpoint.hostname !== HOST || !endpoint.port || typeof state.token !== "string" || !state.token) {
      throw new Error("The active OMP session state is invalid.")
    }
    return { endpoint: endpoint.origin, token: state.token }
  }
}
