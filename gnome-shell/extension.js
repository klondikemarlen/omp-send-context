import Meta from "gi://Meta"
import Shell from "gi://Shell"
import St from "gi://St"
import * as Main from "resource:///org/gnome/shell/ui/main.js"
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js"

import { OmpBridgeClient } from "./bridge.js"

import { createEnvelope, isPtyxisApplication } from "./context.js"

const EXTENSION_NAME = "OMP Send Context"

export default class OmpSendContextExtension extends Extension {
  enable() {
    const settings = this.getSettings()
    const captureSession = { bridge: new OmpBridgeClient() }

    this.captureSession = captureSession
    Main.wm.addKeybinding(
      "desktop-shortcut",
      settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.ALL,
      () => this.captureFocusedPtyxisSelection(captureSession)
    )
  }

  disable() {
    const captureSession = this.captureSession

    this.captureSession = null
    Main.wm.removeKeybinding("desktop-shortcut")
    captureSession?.bridge.close()
  }

  async captureFocusedPtyxisSelection(captureSession) {
    const ptyxisContext = findFocusedPtyxisContext()
    if (!ptyxisContext) {
      Main.notify(EXTENSION_NAME, "Focus a Ptyxis terminal to send terminal context.")
      return
    }

    const selectionText = await getPrimarySelectionText()
    if (!this.isCurrentCaptureSession(captureSession)) {
      return
    }
    if (!selectionText || selectionText.trim().length === 0) {
      Main.notify(EXTENSION_NAME, "No selected text in the focused application.")
      return
    }

    const envelope = createEnvelope({ selectionText, ...ptyxisContext })
    let bridgeState
    try {
      bridgeState = await captureSession.bridge.readState()
    } catch (error) {
      this.notifyCurrentSession(captureSession, error.message)
      return
    }

    if (!this.isCurrentCaptureSession(captureSession)) {
      return
    }

    try {
      await captureSession.bridge.send(bridgeState, envelope)
      this.notifyCurrentSession(captureSession, "Context sent to OMP.")
    } catch (error) {
      this.notifyCurrentSession(captureSession, `Unable to send context: ${error.message}`)
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
}

function findFocusedPtyxisContext() {
  const focusWindow = global.display.focus_window
  if (!focusWindow) {
    return null
  }

  const application =
    focusWindow.get_gtk_application_id() || focusWindow.get_wm_class() || "unknown application"
  if (!isPtyxisApplication(application)) {
    return null
  }

  return {
    application,
    windowTitle: focusWindow.get_title() || "untitled window",
  }
}

function getPrimarySelectionText() {
  return new Promise((resolve) => {
    St.Clipboard.get_default().get_text(St.ClipboardType.PRIMARY, (_clipboard, text) => {
      resolve(text)
    })
  })
}
