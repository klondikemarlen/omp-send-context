import test from "node:test"
import assert from "node:assert/strict"

import { createEnvelope, formatPrompt, isApplicationBlocked } from "#root/gnome-shell/context.js"

test("when creating a GNOME envelope, selected text and window metadata are included", () => {
  // Arrange
  const context = {
    selectionText: "selected application text",
    application: "org.example.Editor.desktop",
    windowTitle: "Project document",
  }

  // Act
  const envelope = createEnvelope(context)

  // Assert
  assert.equal(envelope.version, 1)
  assert.equal(envelope.source, "gnome")
  assert.deepEqual(envelope.metadata, {
    application: "org.example.Editor.desktop",
    title: "Project document",
  })
  assert.equal("url" in envelope.metadata, false)
  assert.match(envelope.prompt, /GNOME desktop application/)
  assert.match(envelope.prompt, /selected application text/)
})

test("when checking a canonical desktop identity, only exact blocklist IDs are blocked", () => {
  // Arrange
  const blocklist = ["org.mozilla.firefox.desktop", "code.desktop"]

  // Act
  const blockedFirefox = isApplicationBlocked("org.mozilla.firefox.desktop", blocklist)
  const blockedCode = isApplicationBlocked("code.desktop", blocklist)
  const unblockedFirefoxLikeApp = isApplicationBlocked("org.example.firefox.desktop", blocklist)
  const unblockedCodeLikeApp = isApplicationBlocked("org.example.code.desktop", blocklist)

  // Assert
  assert.equal(blockedFirefox, true)
  assert.equal(blockedCode, true)
  assert.equal(unblockedFirefoxLikeApp, false)
  assert.equal(unblockedCodeLikeApp, false)
})

test("when an application identity is missing or not a desktop ID, it is blocked", () => {
  // Arrange
  const blocklist = []

  // Act
  const missingIdentity = isApplicationBlocked(null, blocklist)
  const unknownIdentity = isApplicationBlocked("unknown application", blocklist)
  const missingDesktopSuffix = isApplicationBlocked("org.example.App", blocklist)

  // Assert
  assert.equal(missingIdentity, true)
  assert.equal(unknownIdentity, true)
  assert.equal(missingDesktopSuffix, true)
})

test("when creating an envelope with an empty selection, a selection error is thrown", () => {
  // Arrange
  const context = {
    selectionText: " \n",
    application: "terminal",
    windowTitle: "Terminal",
  }

  // Act and Assert
  assert.throws(() => createEnvelope(context), Error)
})

test("when selected text contains backticks, the prompt fence is longer than the selection run", () => {
  // Arrange
  const context = {
    selectionText: "contains ```",
    application: "terminal",
    windowTitle: "Terminal",
  }

  // Act
  const prompt = formatPrompt(context)

  // Assert
  assert.match(prompt, /````\ncontains ```\n````/)
})

test("when selected text has a long backtick run, the prompt fence remains longer", () => {
  // Arrange
  const context = {
    selectionText: "`".repeat(4096),
    application: "terminal",
    windowTitle: "Terminal",
  }

  // Act
  const prompt = formatPrompt(context)

  // Assert
  assert.match(prompt, /`{4097}/)
})
