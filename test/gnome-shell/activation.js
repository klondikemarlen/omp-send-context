import { ExtensionState } from "resource:///org/gnome/shell/misc/extensionUtils.js"
import * as Main from "resource:///org/gnome/shell/ui/main.js"

const EXTENSION_UUID = "omp-send-context-gnome@klondikemarlen.github.io"

export function init() {}

export function run() {}

export function finish() {
  const extensionUnderTest = Main.extensionManager.lookup(EXTENSION_UUID)
  if (!extensionUnderTest) {
    throw new Error(`GNOME Shell did not discover ${EXTENSION_UUID}`)
  }
  if (extensionUnderTest.state !== ExtensionState.ACTIVE) {
    throw new Error(
      `GNOME Shell did not activate ${EXTENSION_UUID}: state ${extensionUnderTest.state}`
    )
  }
}
