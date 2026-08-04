import Gio from "gi://Gio"
import GLib from "gi://GLib"
import Meta from "gi://Meta"
import Shell from "gi://Shell"
import Soup from "gi://Soup"
import St from "gi://St"
import Main from "resource:///org/gnome/shell/ui/main.js"
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js"

import { createEnvelope, isPtyxisApplication } from "./context.js"

const STATE_FILE = [".omp", "agent", "editor-context-bridge.json"]
const HOST = "127.0.0.1"

export default class OmpSendContextExtension extends Extension {
  enable() {
    this._settings = this.getSettings()
    Gio._promisify(Gio.File.prototype, "load_contents_async")
    Gio._promisify(Soup.Session.prototype, "send_and_read_async", "send_and_read_finish")
    this._generation = (this._generation ?? 0) + 1
    this._session = new Soup.Session()
    Main.wm.addKeybinding(
      "desktop-shortcut",
      this._settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.ALL,
      () => this._captureSelection(),
    )
  }

  disable() {
    this._generation += 1
    Main.wm.removeKeybinding("desktop-shortcut")
    this._session.abort()
    this._session = null
    this._settings = null
  }

  _captureSelection() {
    const generation = this._generation
    const window = global.display.focus_window
    const application = window
      ? window.get_gtk_application_id() || window.get_wm_class() || "unknown application"
      : "unknown application"
    if (!isPtyxisApplication(application)) {
      Main.notify("OMP Send Context", "Focus a Ptyxis terminal to send terminal context.")
      return
    }

    const title = window ? window.get_title() || "untitled window" : "untitled window"
    St.Clipboard.get_default().get_text(St.ClipboardType.PRIMARY, async (_clipboard, text) => {
      if (generation !== this._generation) {
        return
      }
      if (!text || text.trim().length === 0) {
        Main.notify("OMP Send Context", "No selected text in the focused application.")
        return
      }
      try {
        await this._send(createEnvelope({ selectionText: text, application, windowTitle: title }), generation)
      } catch (error) {
        if (generation === this._generation) {
          Main.notify("OMP Send Context", error.message)
        }
      }
    })
  }

  async _send(envelope, generation) {
    if (generation !== this._generation || !this._session) {
      return
    }

    let state
    try {
      state = await this._readState()
    } catch (error) {
      if (generation === this._generation) {
        Main.notify("OMP Send Context", error.message)
      }
      return
    }
    if (generation !== this._generation || !this._session) {
      return
    }

    const session = this._session
    const message = Soup.Message.new("POST", `${state.endpoint}/context`)
    message.request_headers.append("Content-Type", "application/json")
    message.request_headers.append("Authorization", `Bearer ${state.token}`)
    const payload = new TextEncoder().encode(JSON.stringify(envelope))
    message.set_request_body_from_bytes("application/json", GLib.Bytes.new(payload))
    try {
      await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null)
      if (generation !== this._generation) {
        return
      }
      if (message.status_code < 200 || message.status_code >= 300) {
        throw new Error(`OMP bridge returned ${message.status_code}`)
      }
      Main.notify("OMP Send Context", "Context sent to OMP.")
    } catch (error) {
      if (generation === this._generation) {
        Main.notify("OMP Send Context", `Unable to send context: ${error.message}`)
      }
    }
  }

  async _readState() {
    const path = GLib.build_filenamev([GLib.get_home_dir(), ...STATE_FILE])
    let contents
    try {
      [contents] = await Gio.File.new_for_path(path).load_contents_async(null)
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
