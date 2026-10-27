import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { createBridgeRuntime } from "#root/omp/bridge-runtime.js"

test("when a GNOME envelope reaches the bridge, authentication is required before delivery", async (t) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), "omp-gnome-envelope-"))
  const stateFile = join(directory, "editor-context-bridge.json")
  const delivered = []
  const runtime = createBridgeRuntime({
    stateFile,
    defaultPort: 0,
    packageFile: fileURLToPath(new URL(import.meta.resolve("#root/package.json"))),
    deliverPrompt: (prompt) => delivered.push(prompt),
    notify: () => {},
  })
  t.after(async () => {
    await runtime.close()
    await rm(directory, { recursive: true, force: true })
  })
  await runtime.start()
  await runtime.claim({ force: true })
  const state = JSON.parse(await readFile(stateFile, "utf8"))
  const body = JSON.stringify({
    version: 1,
    source: "gnome",
    prompt: "Selected GNOME document text",
    metadata: { application: "org.gnome.TextEditor.desktop", title: "Selected document" },
  })

  // Act
  const unauthorized = await fetch(`${runtime.endpoint}/context`, { method: "POST", body })
  const authorized = await fetch(`${runtime.endpoint}/context`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.token}` },
    body,
  })

  // Assert
  assert.equal(unauthorized.status, 401)
  assert.equal(authorized.status, 200)
  assert.deepEqual(delivered, ["Selected GNOME document text"])
})
