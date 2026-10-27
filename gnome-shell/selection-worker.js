import Atspi from "gi://Atspi?version=2.0"
import Gio from "gi://Gio"
import GioUnix from "gi://GioUnix"
import System from "system"

const MAX_NODES = 500
const MAX_SELECTION_LENGTH = 128 * 1024
const MAX_RANGES = 16

try {
  const input = new Gio.DataInputStream({ base_stream: new GioUnix.InputStream({ fd: 0 }) })
  const [line] = input.read_line_utf8(null)
  const { pid, title } = JSON.parse(line)
  if (!Number.isSafeInteger(pid) || pid <= 0 || typeof title !== "string" || title.length > 4096) {
    throw new Error("unavailable")
  }

  Atspi.set_timeout(250, 1000)
  Atspi.init()
  try {
    print(JSON.stringify({ text: readFocusedSelection(pid, title) }))
  } finally {
    Atspi.exit()
  }
} catch {
  print(JSON.stringify({ error: "unavailable" }))
  System.exit(1)
}

function readFocusedSelection(pid, title) {
  const desktop = Atspi.get_desktop(0)
  let application
  for (let index = 0; index < desktop.get_child_count(); index++) {
    const candidate = desktop.get_child_at_index(index)
    if (candidate?.get_process_id() !== pid) continue
    if (application) throw new Error("unavailable")
    application = candidate
  }
  if (!application) throw new Error("unavailable")

  application.set_cache_mask(Atspi.Cache.NONE)
  const pending = [{ node: application, windowMatched: false }]
  let visited = 0
  let focusedText
  while (pending.length > 0 && visited++ < MAX_NODES) {
    const entry = pending.pop()
    const { node } = entry
    if (!node || node.get_process_id() !== pid) continue
    const states = node.get_state_set()
    if (states.contains(Atspi.StateType.DEFUNCT)) continue
    const role = node.get_role()
    if (role === Atspi.Role.PASSWORD_TEXT) continue

    let { windowMatched } = entry
    if (role === Atspi.Role.FRAME || role === Atspi.Role.DIALOG || role === Atspi.Role.WINDOW) {
      windowMatched = states.contains(Atspi.StateType.ACTIVE) && node.get_name() === title
      if (!windowMatched) continue
    }
    if (windowMatched && states.contains(Atspi.StateType.FOCUSED) && node.get_text_iface()) {
      if (focusedText) throw new Error("unavailable")
      focusedText = node
    }

    const children = node.get_child_count()
    if (children > MAX_NODES - visited - pending.length) throw new Error("unavailable")
    for (let index = children - 1; index >= 0; index--) {
      pending.push({ node: node.get_child_at_index(index), windowMatched })
    }
  }
  if (!focusedText || pending.length > 0) throw new Error("unavailable")

  const ranges = readSelectionRanges(focusedText)
  const chunks = []
  let remaining = MAX_SELECTION_LENGTH + 1
  let index = 0
  let truncated = false
  for (; index < ranges.length && remaining > 0; index++) {
    const range = ranges[index]
    const end = Math.min(range.end, range.start + remaining)
    const text = Atspi.Text.prototype.get_text.call(focusedText, range.start, end)
    if (typeof text !== "string") throw new Error("unavailable")
    const boundedText = text.slice(0, remaining)
    chunks.push({ start: range.start, end, text: boundedText })
    remaining -= boundedText.length + 1
    if (end < range.end) truncated = true
  }
  if (index < ranges.length) truncated = true

  requireUnchangedSelection(focusedText, ranges)
  for (const chunk of chunks) {
    const current = Atspi.Text.prototype.get_text.call(focusedText, chunk.start, chunk.end)
    if (typeof current !== "string" || current.slice(0, chunk.text.length) !== chunk.text) {
      throw new Error("unavailable")
    }
  }
  requireUnchangedSelection(focusedText, ranges)
  if (!focusedText.get_state_set().contains(Atspi.StateType.FOCUSED)) {
    throw new Error("unavailable")
  }
  const text = chunks.map((chunk) => chunk.text).join("\n")
  if (!text.trim()) throw new Error("unavailable")
  return truncated ? `${text}\n[selection truncated]` : text
}

function readSelectionRanges(text) {
  const count = Atspi.Text.prototype.get_n_selections.call(text)
  if (count < 1 || count > MAX_RANGES) throw new Error("unavailable")
  const ranges = []
  for (let index = 0; index < count; index++) {
    const range = Atspi.Text.prototype.get_selection.call(text, index)
    if (!range || range.start_offset < 0 || range.end_offset <= range.start_offset) {
      throw new Error("unavailable")
    }
    ranges.push({ start: range.start_offset, end: range.end_offset })
  }
  return ranges
}

function requireUnchangedSelection(text, ranges) {
  if (Atspi.Text.prototype.get_n_selections.call(text) !== ranges.length) {
    throw new Error("unavailable")
  }
  for (let index = 0; index < ranges.length; index++) {
    const current = Atspi.Text.prototype.get_selection.call(text, index)
    if (
      !current ||
      current.start_offset !== ranges[index].start ||
      current.end_offset !== ranges[index].end
    ) {
      throw new Error("unavailable")
    }
  }
}
