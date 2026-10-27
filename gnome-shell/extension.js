import Meta from "gi://Meta"
import Shell from "gi://Shell"
import * as Main from "resource:///org/gnome/shell/ui/main.js"
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js"

import { OmpBridgeClient } from "./bridge.js"
import { createEnvelope, isApplicationBlocked } from "./context.js"
import { SelectionCapture } from "./selection.js"

const EXTENSION_NAME = "OMP Send Context"

export default class OmpSendContextExtension extends Extension {
  enable() {
    const settings = this.getSettings()
    const captureSession = {
      bridge: new OmpBridgeClient(),
      selection: new SelectionCapture(this.path),
      settings,
      focusGeneration: 0,
      busy: false,
    }
    captureSession.focusSignal = global.display.connect("notify::focus-window", () => {
      captureSession.focusGeneration += 1
    })

    this.captureSession = captureSession
    Main.wm.addKeybinding(
      "desktop-shortcut",
      settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.NORMAL,
      () => this.captureFocusedSelection(captureSession)
    )
  }

  disable() {
    const captureSession = this.captureSession

    this.captureSession = null
    Main.wm.removeKeybinding("desktop-shortcut")
    if (captureSession) global.display.disconnect(captureSession.focusSignal)
    captureSession?.selection.close()
    captureSession?.bridge.close()
  }

  async captureFocusedSelection(captureSession) {
    if (!this.isCurrentCaptureSession(captureSession)) return
    if (captureSession.busy) {
      this.notifyCurrentSession(captureSession, "A selection capture is already in progress.")
      return
    }

    captureSession.busy = true
    try {
      const window = global.display.focus_window
      const app = window && Shell.WindowTracker.get_default().get_window_app(window)
      const application = app?.get_id()
      if (!window || !application?.endsWith(".desktop")) {
        throw new Error("The focused application could not be identified. Nothing was captured.")
      }
      if (
        isApplicationBlocked(application, captureSession.settings.get_strv("blocked-applications"))
      ) {
        throw new Error(
          "This application is blocked. Use its own Send Context integration or adjust the GNOME blocklist."
        )
      }

      const generation = captureSession.focusGeneration
      const windowTitle = window.get_title() || ""
      const selectionText = await captureSession.selection.capture(window.get_pid(), windowTitle)
      if (!this.isCurrentCaptureSession(captureSession)) return
      this.requireUnchangedFocus(captureSession, window, generation)

      const envelope = createEnvelope({ selectionText, application, windowTitle })
      const bridgeState = await captureSession.bridge.readState()
      if (!this.isCurrentCaptureSession(captureSession)) return
      this.requireUnchangedFocus(captureSession, window, generation)

      await captureSession.bridge.send(bridgeState, envelope)
      this.notifyCurrentSession(captureSession, "Context sent to OMP.")
    } catch (error) {
      this.reportFailure(captureSession, error.message)
    } finally {
      captureSession.busy = false
    }
  }

  requireUnchangedFocus(captureSession, window, generation) {
    if (global.display.focus_window !== window || captureSession.focusGeneration !== generation) {
      throw new Error("Focus changed during capture. Nothing was sent; select text and try again.")
    }
  }

  isCurrentCaptureSession(captureSession) {
    return this.captureSession === captureSession
  }

  notifyCurrentSession(captureSession, message) {
    if (this.isCurrentCaptureSession(captureSession)) {
      Main.notify(EXTENSION_NAME, message)
    }
  }

  reportFailure(captureSession, message) {
    if (!this.isCurrentCaptureSession(captureSession)) return

    console.error(`${EXTENSION_NAME}: ${message}`)
    Main.notify(EXTENSION_NAME, message)
  }
}
