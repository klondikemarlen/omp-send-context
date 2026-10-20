import test from "node:test"
import assert from "node:assert/strict"

import { createEnvelope, formatPrompt, isPtyxisApplication } from "#root/gnome-shell/context.js"

test("when creating a Ptyxis envelope, selected text and window metadata are included", () => {
  // Arrange
  const context = {
    selectionText: "selected terminal text",
    application: "org.gnome.Ptyxis",
    windowTitle: "Project terminal",
  }

  // Act
  const envelope = createEnvelope(context)

  // Assert
  assert.deepEqual(envelope.metadata, {
    application: "org.gnome.Ptyxis",
    title: "Project terminal",
  })
  assert.match(envelope.prompt, /selected terminal text/)
})

test("when checking an application name, Ptyxis is recognized and other terminals are not", () => {
  // Arrange
  const ptyxisApplication = "org.gnome.Ptyxis"
  const otherTerminalApplication = "org.gnome.Terminal"

  // Act
  const isPtyxis = isPtyxisApplication(ptyxisApplication)
  const isOtherTerminalPtyxis = isPtyxisApplication(otherTerminalApplication)

  // Assert
  assert.equal(isPtyxis, true)
  assert.equal(isOtherTerminalPtyxis, false)
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
