import test from "node:test"
import assert from "node:assert/strict"

import { createEnvelope, formatPrompt, isPtyxisApplication } from "../gnome-shell/context.js"

test("Ptyxis context creates a bounded terminal envelope", () => {
  const envelope = createEnvelope({
    selectionText: "selected terminal text",
    application: "org.gnome.Ptyxis",
    windowTitle: "Project terminal",
  })

  assert.equal(envelope.version, 1)
  assert.equal(envelope.source, "ptyxis")
  assert.deepEqual(envelope.metadata, { application: "org.gnome.Ptyxis", title: "Project terminal" })
  assert.match(envelope.prompt, /## Ptyxis terminal/)
  assert.match(envelope.prompt, /selected terminal text/)
})

test("Ptyxis context recognizes only Ptyxis windows", () => {
  assert.equal(isPtyxisApplication("org.gnome.Ptyxis"), true)
  assert.equal(isPtyxisApplication("org.gnome.Terminal"), false)
})

test("Ptyxis context rejects empty selection and lengthens fences", () => {
  assert.throws(() => createEnvelope({ selectionText: " \n", application: "terminal", windowTitle: "Terminal" }), /Select text/)
  const prompt = formatPrompt({ selectionText: "contains ```", application: "terminal", windowTitle: "Terminal" })
  assert.match(prompt, /````\ncontains ```\n````/)
})
