import { ExtensionState } from "resource:///org/gnome/shell/misc/extensionUtils.js"
import * as Main from "resource:///org/gnome/shell/ui/main.js"

const UUID = "omp-send-context-gnome@klondikemarlen.github.io"

export function init() {}

export function run() {}

export function finish() {
  const extension = Main.extensionManager.lookup(UUID)
  if (!extension) throw new Error(`GNOME Shell did not discover ${UUID}`)
  if (extension.state !== ExtensionState.ACTIVE)
    throw new Error(`GNOME Shell did not activate ${UUID}: state ${extension.state}`)
}
