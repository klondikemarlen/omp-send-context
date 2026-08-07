import test from "node:test"
import assert from "node:assert/strict"

import { configureGnomeUpload, uploadGnomeExtension } from "../upload-gnome.mjs"

test("GNOME secret setup prompts for and stores the account", async () => {
  const stored = []
  await configureGnomeUpload({
    prompt: async () => "maintainer@example.com",
    storeSecret: async (attributes) => stored.push(attributes),
  })
  assert.deepEqual(stored, [
    {
      label: "GNOME Extensions upload password",
      service: "extensions.gnome.org",
      project: "omp-send-context",
      account: "maintainer@example.com",
      purpose: "upload",
    },
  ])
})

test("GNOME deployment stops before external calls", async () => {
  let prompted = false
  let lookedUpSecret = false
  let fetched = false

  await assert.rejects(
    uploadGnomeExtension({
      prompt: async () => {
        prompted = true
      },
      lookupSecret: async () => {
        lookedUpSecret = true
      },
      fetchImpl: async () => {
        fetched = true
      },
    }),
    /DO NOT UPLOAD/
  )
  assert.deepEqual(
    { prompted, lookedUpSecret, fetched },
    {
      prompted: false,
      lookedUpSecret: false,
      fetched: false,
    }
  )
})
