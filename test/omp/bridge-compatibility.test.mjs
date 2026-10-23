import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"

import { resolveBridgeState } from "#root/omp/bridge-discovery.js"

import { createBridgeRuntime } from "#root/omp/bridge-runtime.js"

async function createFixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-bridge-compatibility-"))
  return {
    directory,
    packageFile: path.join(directory, "package.json"),
    stateFile: path.join(directory, "editor-context-bridge.json"),
    async cleanup() {
      await fs.rm(directory, { recursive: true, force: true })
    },
  }
}

test("when installed files change, health still identifies the running plugin without credentials", async () => {
  // Arrange
  const fixture = await createFixture()
  await fs.writeFile(fixture.packageFile, JSON.stringify({ version: "3.0.0" }))
  const runtime = createBridgeRuntime({
    deliverPrompt() {},
    notify() {},
    packageFile: fixture.packageFile,
    stateFile: fixture.stateFile,
    defaultPort: 0,
  })

  try {
    await runtime.start()
    const state = await resolveBridgeState(fixture.stateFile)
    await fs.writeFile(fixture.packageFile, JSON.stringify({ version: "4.0.0" }))

    // Act
    const response = await fetch(`${runtime.endpoint}/health`)
    const health = await response.json()

    // Assert
    assert.equal(response.status, 200)
    assert.deepEqual(health, {
      ok: true,
      instanceId: state.instanceId,
      endpoint: runtime.endpoint,
      pid: process.pid,
      version: "3.0.0",
      protocolVersion: 1,
    })
  } finally {
    await runtime.close()
    await fixture.cleanup()
  }
})

test("when compatible package versions coexist after suspend, later activity receives context", async (t) => {
  // Arrange
  const fixture = await createFixture()
  const olderPrompts = []
  await fs.writeFile(fixture.packageFile, JSON.stringify({ version: "3.0.0" }))
  const older = createBridgeRuntime({
    deliverPrompt(prompt) {
      olderPrompts.push(prompt)
    },
    notify() {},
    packageFile: fixture.packageFile,
    stateFile: fixture.stateFile,
    defaultPort: 0,
  })
  const newerPrompts = []
  const newer = createBridgeRuntime({
    deliverPrompt(prompt) {
      newerPrompts.push(prompt)
    },
    notify() {},
    packageFile: fixture.packageFile,
    stateFile: fixture.stateFile,
    defaultPort: 0,
  })

  try {
    await older.start()
    await fs.writeFile(fixture.packageFile, JSON.stringify({ version: "4.0.0" }))
    await newer.start()
    await newer.claim({ force: true, claimedAt: Date.now() - 1000 })
    const originalNow = performance.now.bind(performance)
    t.mock.method(performance, "now", () => originalNow() - 28_027_833)

    // Act
    await older.claim({ force: true })
    const selected = await resolveBridgeState(fixture.stateFile)
    const response = await fetch(`${selected.endpoint}/context`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${selected.token}`,
        "X-OMP-Instance-Id": selected.instanceId,
      },
      body: JSON.stringify({ version: 1, source: "vscode", prompt: "cross-version-context" }),
    })

    // Assert
    assert.equal(response.status, 200)
    assert.deepEqual(olderPrompts, ["cross-version-context"])
    assert.deepEqual(newerPrompts, [])
  } finally {
    await Promise.all([older.close(), newer.close()])
    await fixture.cleanup()
  }
})
