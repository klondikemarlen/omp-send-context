import test from "node:test"
import assert from "node:assert/strict"

import { uploadGnomeExtension } from "#root/upload-gnome.mjs"

test("when GNOME deployment is paused, upload is rejected before prompting or external calls", async () => {
  // Arrange
  const sideEffects = { prompted: false, lookedUpSecret: false, fetched: false }

  // Act
  const uploadAttempt = uploadGnomeExtension({
    zipPath: "candidate.shell-extension.zip",
    prompt: async () => {
      sideEffects.prompted = true
    },
    lookupSecret: async () => {
      sideEffects.lookedUpSecret = true
    },
    fetchImpl: async () => {
      sideEffects.fetched = true
    },
  })

  // Assert
  await assert.rejects(uploadAttempt, Error)
  assert.deepEqual(sideEffects, {
    prompted: false,
    lookedUpSecret: false,
    fetched: false,
  })
})
