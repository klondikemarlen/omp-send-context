import Gio from "gi://Gio"
import GLib from "gi://GLib"
import Soup from "gi://Soup"

const STATE_FILE = [".omp", "agent", "editor-context-bridge.json"]
const HOST = "127.0.0.1"

export class OmpBridgeClient {
  constructor() {
    Gio._promisify(Gio.File.prototype, "load_contents_async")
    Gio._promisify(Soup.Session.prototype, "send_and_read_async", "send_and_read_finish")
    this.httpSession = new Soup.Session()
  }

  close() {
    const httpSession = this.httpSession
    if (!httpSession) return

    this.httpSession = null
    httpSession.abort()
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
    const httpSession = this.httpSession
    if (!httpSession) {
      throw new Error("OMP bridge client is closed.")
    }

    const message = Soup.Message.new("POST", `${state.endpoint}/context`)
    message.request_headers.append("Content-Type", "application/json")
    message.request_headers.append("Authorization", `Bearer ${state.token}`)
    const payload = new TextEncoder().encode(JSON.stringify(envelope))
    message.set_request_body_from_bytes("application/json", GLib.Bytes.new(payload))
    await httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null)
    if (message.status_code < 200 || message.status_code >= 300) {
      throw new Error(`OMP bridge returned ${message.status_code}`)
    }
  }
}

function parseBridgeState(contents) {
  try {
    const state = JSON.parse(new TextDecoder().decode(contents))
    const endpoint = GLib.Uri.parse(state.endpoint, GLib.UriFlags.NONE)
    const port = endpoint.get_port()
    if (
      endpoint.get_scheme() !== "http" ||
      endpoint.get_host() !== HOST ||
      port < 0 ||
      typeof state.token !== "string" ||
      !state.token
    ) {
      throw new Error("The active OMP session state is invalid.")
    }
    return { endpoint: `http://${HOST}:${port}`, token: state.token }
  } catch {
    throw new Error("The active OMP session state is invalid.")
  }
}
