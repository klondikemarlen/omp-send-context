import test from "node:test"
import assert from "node:assert/strict"

import { classifyTerminalActivity } from "../../omp/terminal-activity.js"

test("when terminal replies arrive, they remain available to OMP without selecting the console", () => {
  // Arrange
  const replies = [
    "\x1b[1;1R",
    "\x1b[?62;4;6;22c",
    "\x1b[?1u",
    "\x1b[?1004;1$y",
    "\x1b[?2;0;256S",
    "\x1b]11;rgb:ffff/ffff/ffff\x1b\\",
  ]

  // Act / Assert
  for (const reply of replies) {
    assert.deepEqual(classifyTerminalActivity(reply), { data: reply, hasActivity: false })
  }
})

test("when mouse reports arrive without a focus event, they do not select the console", () => {
  // Arrange
  const reports = [
    "\x1b[<35;12;5M",
    "\x1b[<0;12;5M",
    "\x1b[<0;12;5m",
    "\x1b[<64;12;5M",
    "\x1b[M !!",
  ]

  // Act / Assert
  for (const report of reports) {
    assert.deepEqual(classifyTerminalActivity(report), { data: report, hasActivity: false })
  }
})

test("when keyboard input accompanies a reply, the console is selected without losing input", () => {
  // Arrange
  const input = "\x1b[?2;0;256Sdraft\x1b[1;5D\x1b[97;1u"

  // Act
  const activity = classifyTerminalActivity(input)

  // Assert
  assert.deepEqual(activity, { data: input, hasActivity: true })
})

test("when OMP delivers focus-in, it selects the console without forwarding the report", () => {
  // Arrange
  const input = "\x1b[I"

  // Act
  const activity = classifyTerminalActivity(input)

  // Assert
  assert.deepEqual(activity, { data: "", hasActivity: true })
})

test("when OMP delivers focus-out, it neither selects the console nor forwards the report", () => {
  // Arrange
  const input = "\x1b[O"

  // Act
  const activity = classifyTerminalActivity(input)

  // Assert
  assert.deepEqual(activity, { data: "", hasActivity: false })
})

test("when OMP delivers a standalone Escape key, it is forwarded without waiting for another key", () => {
  // Arrange
  const input = "\x1b"

  // Act
  const activity = classifyTerminalActivity(input)

  // Assert
  assert.deepEqual(activity, { data: "\x1b", hasActivity: true })
})

test("when pasted content contains focus-like text, the paste is preserved without interpreting its contents", () => {
  // Arrange
  const input = "\x1b[200~quoted \x1b[I and \x1b[O\x1b[201~"

  // Act
  const activity = classifyTerminalActivity(input)

  // Assert
  assert.deepEqual(activity, { data: input, hasActivity: true })
})
