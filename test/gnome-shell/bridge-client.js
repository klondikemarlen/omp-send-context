import Gio from "gi://Gio"
import GLib from "gi://GLib"
import { OmpBridgeClient } from "../../gnome-shell/bridge.js"

const action = ARGV[0] ?? "read"

const client = new OmpBridgeClient()
try {
  const state = await client.readState()
  if (action === "send" || action === "close-during-send" || action === "send-closed") {
    const envelope = {
      version: 1,
      source: "ptyxis",
      prompt: "Native GJS bridge selection",
    }

    if (action === "send-closed") {
      client.close()
    }

    const sending = client.send(state, envelope)
    if (action === "close-during-send") {
      await waitForCloseSignal()
      client.close()
    }

    let sendError
    try {
      await sending
    } catch (error) {
      sendError = error
    }

    if (action === "close-during-send") {
      if (!sendError) {
        throw new Error("Expected the pending send to be canceled.")
      }
      print("send-cancelled")
    } else if (sendError) {
      throw sendError
    }
  }
} finally {
  client.close()
}

async function waitForCloseSignal() {
  Gio._promisify(Gio.InputStream.prototype, "read_bytes_async", "read_bytes_finish")
  const standardInput = Gio.UnixInputStream.new(0, false)
  await standardInput.read_bytes_async(1, GLib.PRIORITY_DEFAULT, null)
}
