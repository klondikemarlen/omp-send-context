import { OmpBridgeClient } from "../../gnome-shell/bridge.js"

const client = new OmpBridgeClient()
try {
  const state = await client.readState()
  if (ARGV[0] === "send") {
    await client.send(state, {
      version: 1,
      source: "ptyxis",
      prompt: "Native GJS bridge selection",
    })
  }
} finally {
  client.close()
}
