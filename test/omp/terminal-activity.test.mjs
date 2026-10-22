import test from "node:test"
import assert from "node:assert/strict"

import { createTerminalActivityTracker } from "../../omp/terminal-activity.js"

test("when terminal replies arrive, they remain available to OMP without selecting the console", () => {
  // Arrange
  const readActivity = createTerminalActivityTracker()
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
    assert.deepEqual(readActivity(reply), { data: reply, hasActivity: false })
  }
})

test("when mouse reports arrive without a focus event, they do not select the console", () => {
  // Arrange
  const readActivity = createTerminalActivityTracker()
  const reports = [
    "\x1b[<35;12;5M",
    "\x1b[<0;12;5M",
    "\x1b[<0;12;5m",
    "\x1b[<64;12;5M",
    "\x1b[M !!",
  ]

  // Act / Assert
  for (const report of reports) {
    assert.deepEqual(readActivity(report), { data: report, hasActivity: false })
  }
})

test("when keyboard input accompanies a reply, the console is selected without losing input", () => {
  // Arrange
  const readActivity = createTerminalActivityTracker()
  const input = "\x1b[?2;0;256Sdraft\x1b[1;5D\x1b[97;1u"

  // Act
  const activity = readActivity(input)

  // Assert
  assert.deepEqual(activity, { data: input, hasActivity: true })
})

test("when focus reports cross input boundaries, only focus-in selects and reports stay out of the editor", () => {
  // Arrange
  const readActivity = createTerminalActivityTracker()

  // Act / Assert
  assert.deepEqual(readActivity("\x1b[O"), { data: "", hasActivity: false })
  assert.deepEqual(readActivity("\x1b"), { data: "", hasActivity: false })
  assert.deepEqual(readActivity("["), { data: "", hasActivity: false })
  assert.deepEqual(readActivity("I"), { data: "", hasActivity: true })
  assert.deepEqual(readActivity("\x1b[O"), { data: "", hasActivity: false })
})
