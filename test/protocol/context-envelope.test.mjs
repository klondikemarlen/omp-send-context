import test from "node:test"
import assert from "node:assert/strict"

import { isContextEnvelope } from "#root/omp/bridge-runtime.js"

test("when an envelope has an unsupported version or invalid metadata, the bridge rejects it", () => {
  // Arrange
  const envelope = { version: 1, source: "gnome", prompt: "selected text" }
  const invalidEnvelopes = [
    { ...envelope, version: 2 },
    { ...envelope, source: "invalid" },
    { ...envelope, prompt: "" },
    { ...envelope, metadata: [] },
    { ...envelope, metadata: { url: 42 } },
    { ...envelope, metadata: { title: 42 } },
  ]

  // Act
  const accepted = invalidEnvelopes.map(isContextEnvelope)

  // Assert
  assert.deepEqual(accepted, [false, false, false, false, false, false])
})

test("when an array carries otherwise valid envelope properties, the bridge rejects it", () => {
  // Arrange
  const envelope = []
  Object.assign(envelope, { version: 1, source: "gnome", prompt: "selected text" })

  // Act
  const accepted = isContextEnvelope(envelope)

  // Assert
  assert.equal(accepted, false)
})
