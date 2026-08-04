import Meta from "gi://Meta"
import Shell from "gi://Shell"
import St from "gi://St"
import Main from "resource:///org/gnome/shell/ui/main.js"
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js"

import { OmpBridgeClient } from "./bridge.js"

import { createEnvelope, isPtyxisApplication } from "./context.js"


export default class OmpSendContextExtension extends Extension {
  enable() {
    this._settings = this.getSettings()
    this._generation = (this._generation ?? 0) + 1
    this._bridge = new OmpBridgeClient()
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
    this._bridge.close()
    this._bridge = null
    this._settings = null
  }

  _captureSelection() {
    const generation = this._generation
    const focusWindow = global.display.focus_window
    const application = focusWindow
      ? focusWindow.get_gtk_application_id() || focusWindow.get_wm_class() || "unknown application"
      : "unknown application"
    if (!isPtyxisApplication(application)) {
      Main.notify("OMP Send Context", "Focus a Ptyxis terminal to send terminal context.")
      return
    }

    const title = focusWindow ? focusWindow.get_title() || "untitled window" : "untitled window"
    St.Clipboard.get_default().get_text(St.ClipboardType.PRIMARY, async (_clipboard, text) => {
      if (generation !== this._generation) {
        return
      }
      if (!text || text.trim().length === 0) {
        Main.notify("OMP Send Context", "No selected text in the focused application.")
        return
      }

      const envelope = createEnvelope({ selectionText: text, application, windowTitle: title })
      let state
      try {
        state = await this._bridge.readState()
      } catch (error) {
        if (generation === this._generation) {
          Main.notify("OMP Send Context", error.message)
        }
        return
      }
      if (generation !== this._generation || !this._bridge) {
        return
      }

      try {
        await this._bridge.send(state, envelope)
        if (generation === this._generation) {
          Main.notify("OMP Send Context", "Context sent to OMP.")
        }
      } catch (error) {
        if (generation === this._generation) {
          Main.notify("OMP Send Context", `Unable to send context: ${error.message}`)
        }
      }
    })
  }

}
