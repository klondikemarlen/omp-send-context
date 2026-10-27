import Gio from "gi://Gio"
import GLib from "gi://GLib"

const CAPTURE_TIMEOUT_MS = 2500
const MAX_OUTPUT_LENGTH = 2 * 1024 * 1024
const UNAVAILABLE_MESSAGE =
  "Selection unavailable. Select text in an application that exposes focused text through accessibility, then try again. Clipboard contents were not used."

Gio._promisify(Gio.Subprocess.prototype, "communicate_utf8_async", "communicate_utf8_finish")

export class SelectionCapture {
  constructor(extensionPath) {
    this.workerPath = GLib.build_filenamev([extensionPath, "selection-worker.js"])
    this.jobs = new Set()
    this.closed = false
  }

  async capture(pid, title) {
    if (this.closed) throw new Error(UNAVAILABLE_MESSAGE)

    let process
    try {
      process = Gio.Subprocess.new(
        ["gjs", "-m", this.workerPath],
        Gio.SubprocessFlags.STDIN_PIPE |
          Gio.SubprocessFlags.STDOUT_PIPE |
          Gio.SubprocessFlags.STDERR_SILENCE
      )
    } catch {
      throw new Error(UNAVAILABLE_MESSAGE)
    }

    const cancellable = new Gio.Cancellable()
    const job = { process, cancellable }
    this.jobs.add(job)
    let timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CAPTURE_TIMEOUT_MS, () => {
      timeout = 0
      process.force_exit()
      cancellable.cancel()
      return GLib.SOURCE_REMOVE
    })

    try {
      const [stdout] = await process.communicate_utf8_async(
        `${JSON.stringify({ pid, title })}\n`,
        cancellable
      )
      if (this.closed || !process.get_successful() || stdout.length > MAX_OUTPUT_LENGTH) {
        throw new Error(UNAVAILABLE_MESSAGE)
      }
      const result = JSON.parse(stdout)
      if (typeof result.text !== "string" || !result.text.trim()) {
        throw new Error(UNAVAILABLE_MESSAGE)
      }
      return result.text
    } catch {
      throw new Error(UNAVAILABLE_MESSAGE)
    } finally {
      if (timeout) GLib.Source.remove(timeout)
      this.jobs.delete(job)
    }
  }

  close() {
    this.closed = true
    for (const { process, cancellable } of this.jobs) {
      process.force_exit()
      cancellable.cancel()
    }
  }
}
