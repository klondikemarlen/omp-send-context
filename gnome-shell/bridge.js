import Gio from "gi://Gio"
import GLib from "gi://GLib"
import Soup from "gi://Soup"

const STATE_FILE = [".omp", "agent", "editor-context-bridge.json"]
const HOST = "127.0.0.1"

export class OmpBridgeClient {
  constructor() {
    Gio._promisify(Gio.File.prototype, "load_contents_async")
    Gio._promisify(Soup.Session.prototype, "send_and_read_async", "send_and_read_finish")
    this._session = new Soup.Session()
  }

  close() {
    this._session.abort()
    this._session = null
  }

  async readState() {
    const path = GLib.build_filenamev([GLib.get_home_dir(), ...STATE_FILE])
    let contents
    try {
      ;[contents] = await Gio.File.new_for_path(path).load_contents_async(null)
    } catch {
      throw new Error("No active OMP session was found.")
    }

    return parseBridgeState(contents)
  }

  async send(state, envelope) {
    const session = this._session
    if (!session) {
      return
    }

    const message = Soup.Message.new("POST", `${state.endpoint}/context`)
    message.request_headers.append("Content-Type", "application/json")
    message.request_headers.append("Authorization", `Bearer ${state.token}`)
    const payload = new TextEncoder().encode(JSON.stringify(envelope))
    message.set_request_body_from_bytes("application/json", GLib.Bytes.new(payload))
    await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null)
    if (message.status_code < 200 || message.status_code >= 300) {
      throw new Error(`OMP bridge returned ${message.status_code}`)
    }
  }
}

function parseBridgeState(contents) {
  try {
    const state = JSON.parse(new TextDecoder().decode(contents))
    const endpoint = new URL(state.endpoint)
    if (
      endpoint.protocol !== "http:" ||
      endpoint.hostname !== HOST ||
      !endpoint.port ||
      typeof state.token !== "string" ||
      !state.token
    ) {
      throw new Error("The active OMP session state is invalid.")
    }
    return { endpoint: endpoint.origin, token: state.token }
  } catch {
    throw new Error("The active OMP session state is invalid.")
  }
}
