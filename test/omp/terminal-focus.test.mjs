import test from "node:test"
import assert from "node:assert/strict"

import { createTerminalFocusObserver } from "#root/omp/terminal-focus.js"

test("when focus reports share a read with keys and replies, the observer reports focus in order", () => {
  // Arrange
  const reports = []
  const observe = createTerminalFocusObserver((focused) => reports.push(focused))
  const input = Buffer.from("ĝ[I\x1b[1I\x1b[Ityped\x1b[?1004;1$y\x1b[O\x1b[I")

  // Act
  observe(input)

  // Assert
  assert.deepEqual(reports, [true, false, true])
  assert.deepEqual(input, Buffer.from("ĝ[I\x1b[1I\x1b[Ityped\x1b[?1004;1$y\x1b[O\x1b[I"))
})

test("when a focus report arrives in fragments, the observer waits for the final byte", (t) => {
  // Arrange
  let now = 0
  t.mock.method(performance, "now", () => now)
  const reports = []
  const observe = createTerminalFocusObserver((focused) => reports.push(focused))

  // Act
  observe(Buffer.from("\x1b"))
  now += 19
  observe(Buffer.from("["))
  const partialReports = [...reports]
  now += 19
  observe(Buffer.from("I"))

  // Assert
  assert.deepEqual(partialReports, [])
  assert.deepEqual(reports, [true])
})

test("when key-sized escape prefixes idle past OMP framing, later text does not become focus", (t) => {
  // Arrange
  let now = 0
  t.mock.method(performance, "now", () => now)
  const reports = []
  const observe = createTerminalFocusObserver((focused) => reports.push(focused))

  // Act
  observe("\x1b")
  now += 20
  observe("[I")
  observe("\x1b[")
  now += 20
  observe("O")
  observe("\x1b[I")

  // Assert
  assert.deepEqual(reports, [true])
})

test("when bracketed paste spans reads, only focus outside the paste is reported", (t) => {
  // Arrange
  let now = 0
  t.mock.method(performance, "now", () => now)
  const reports = []
  const observe = createTerminalFocusObserver((focused) => reports.push(focused))

  // Act
  observe("\x1b[2")
  now += 50
  observe("00~body \x1b[I \x1b[200~ \x1b[201x")
  now += 2_000
  observe("\x1b[I\x1b\x1b[20")
  observe("1~\x1b[O")

  // Assert
  assert.deepEqual(reports, [false])
})

test("when an OSC reply contains focus bytes, only focus after BEL or ST is reported", (t) => {
  // Arrange
  t.mock.method(performance, "now", () => 0)
  const reports = []
  const observe = createTerminalFocusObserver((focused) => reports.push(focused))

  // Act
  observe("\x1b")
  observe("]11;title\x1b[I\x07\x1b[O\x1b]0;title\x1b[O\x1b")
  observe("\\\x1b[I")

  // Assert
  assert.deepEqual(reports, [false, true])
})

test("when DCS, APC, PM, and SOS carry focus bytes and BEL, they remain opaque until ST", () => {
  // Arrange
  const reports = []
  const observe = createTerminalFocusObserver((focused) => reports.push(focused))

  // Act
  observe("\x1bPpayload\x1b[I\x07\x1b[O\x1b")
  observe("\\\x1b_payload\x1b[I\x07\x1b[O\x1b\\")
  observe("\x1b^payload\x1b[I\x07\x1b[O\x1b\\")
  observe("\x1bXpayload\x1b[I\x07\x1b[O\x1b\\\x1b[I")

  // Assert
  assert.deepEqual(reports, [true])
})

test("when an unterminated DCS goes idle, refocusing selects the console without rearming", (t) => {
  // Arrange
  let now = 0
  t.mock.method(performance, "now", () => now)
  const reports = []
  const observe = createTerminalFocusObserver((focused) => reports.push(focused))

  // Act
  observe("\x1bP")
  now += 4_999
  observe("payload\x1b[I")
  now += 5_000
  observe("\x1b[I")
  observe("\x1b[O")

  // Assert
  assert.deepEqual(reports, [true, false])
})

test("when a tmux passthrough carries an escaped ST, it does not expose its focus bytes", () => {
  // Arrange
  const reports = []
  const observe = createTerminalFocusObserver((focused) => reports.push(focused))

  // Act
  observe("\x1bPtm")
  observe("ux;\x1b\x1b]11;payload\x1b")
  observe("\x1b\\\x1b\x1b[I\x1b\\\x1b[O")

  // Assert
  assert.deepEqual(reports, [false])
})

test("when mouse reports contain focus-like bytes, only focus after the reports is reported", () => {
  // Arrange
  const reports = []
  const observe = createTerminalFocusObserver((focused) => reports.push(focused))

  // Act
  observe("\x1b[<35;12;5M\x1b[32;12;5M\x1b[M !!\x1b[M\x1b")
  observe("[I\x1b[O")

  // Assert
  assert.deepEqual(reports, [false])
})
