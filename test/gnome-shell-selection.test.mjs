import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import { createEnvelope } from "#root/gnome-shell/context.js"

const workerSource = await readFile(
  process.env.OMP_SELECTION_WORKER ??
    new URL(import.meta.resolve("#root/gnome-shell/selection-worker.js")),
  "utf8"
)
const runWorker = Function(
  "Atspi",
  "Gio",
  "GioUnix",
  "System",
  "print",
  workerSource.replace(/^import .*$/gm, "")
)

function captureSelection({ text, ranges, onRead }) {
  let reads = 0
  let result
  const state = { text, ranges }
  const textNode = {
    get_process_id: () => 123,
    get_state_set: () => ({ contains: (value) => value === "focused" }),
    get_role: () => "text",
    get_text_iface: () => textNode,
    get_child_count: () => 0,
  }
  const frame = {
    get_process_id: () => 123,
    get_state_set: () => ({ contains: (value) => value === "active" }),
    get_role: () => "frame",
    get_name: () => "Selected window",
    get_child_count: () => 1,
    get_child_at_index: () => textNode,
  }
  const application = {
    get_process_id: () => 123,
    get_state_set: () => ({ contains: () => false }),
    get_role: () => "application",
    set_cache_mask: () => {},
    get_child_count: () => 1,
    get_child_at_index: () => frame,
  }
  const Atspi = {
    init: () => {},
    exit: () => {},
    set_timeout: () => {},
    Cache: { NONE: 0 },
    StateType: { DEFUNCT: "defunct", FOCUSED: "focused", ACTIVE: "active" },
    Role: { PASSWORD_TEXT: "password", FRAME: "frame", DIALOG: "dialog", WINDOW: "window" },
    get_desktop: () => ({ get_child_count: () => 1, get_child_at_index: () => application }),
    Text: {
      prototype: {
        get_n_selections() {
          return state.ranges.length
        },
        get_selection(index) {
          const range = state.ranges[index]
          return range && { start_offset: range[0], end_offset: range[1] }
        },
        get_text(start, end) {
          onRead?.(state, ++reads)
          return state.text.slice(start, end)
        },
      },
    },
  }
  const Gio = {
    DataInputStream: class {
      read_line_utf8() {
        return [JSON.stringify({ pid: 123, title: "Selected window" })]
      }
    },
  }
  const GioUnix = { InputStream: class {} }
  runWorker(Atspi, Gio, GioUnix, { exit: () => {} }, (value) => {
    result = JSON.parse(value)
  })
  return result
}

test("when selected text is replaced and selection collapses during capture, replacement text is not returned", () => {
  // Arrange
  const input = {
    text: "public",
    ranges: [[0, 6]],
    onRead(state) {
      state.text = "secret"
      state.ranges = []
    },
  }

  // Act
  const result = captureSelection(input)

  // Assert
  assert.deepEqual(result, { error: "unavailable" })
})

test("when text changes at unchanged selected offsets, an inconsistent capture is rejected", () => {
  // Arrange
  const input = {
    text: "public",
    ranges: [[0, 6]],
    onRead(state, read) {
      if (read === 2) state.text = "secret"
    },
  }

  // Act
  const result = captureSelection(input)

  // Assert
  assert.deepEqual(result, { error: "unavailable" })
})

test("when an exact-limit first range leaves more selected text, the handoff marks truncation", () => {
  // Arrange
  const limit = 128 * 1024
  const input = {
    text: `${"a".repeat(limit)}second`,
    ranges: [
      [0, limit],
      [limit, limit + 6],
    ],
  }

  // Act
  const result = captureSelection(input)
  const envelope = createEnvelope({
    selectionText: result.text,
    application: "org.gnome.TextEditor.desktop",
    windowTitle: "Selected window",
  })

  // Assert
  assert.match(envelope.prompt, /\[selection truncated\]/)
  assert.doesNotMatch(envelope.prompt, /second/)
})
