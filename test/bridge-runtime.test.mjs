import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createServer } from "node:http"

import { createBridgeRuntime } from "../omp/bridge-runtime.js"

async function availablePort() {
  const server = createServer()
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address()
  await new Promise(resolve => server.close(resolve))
  return port
}

test("bridge runtime owns HTTP delivery and state lifecycle", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-vscode-context-runtime-"))
  const stateFile = path.join(directory, "agent", "editor-context-bridge.json")
  const deliveredPrompts = []
  const runtime = createBridgeRuntime({
    async deliverPrompt(prompt) {
      deliveredPrompts.push(prompt)
    },
    notify() {},
    packageFile: path.resolve("package.json"),
    stateFile,
    defaultPort: await availablePort(),
  })

  try {
    await runtime.start()
    assert.equal(await runtime.claim({ force: true }), true)

    const state = JSON.parse(await fs.readFile(stateFile, "utf8"))
    assert.equal(state.endpoint, runtime.endpoint)
    assert.equal(state.version, runtime.version)

    const health = await fetch(`${runtime.endpoint}/health`)
    assert.equal(health.status, 200)
    assert.equal((await health.json()).endpoint, runtime.endpoint)

    const unauthorized = await fetch(`${runtime.endpoint}/context`, {
      method: "POST",
      body: JSON.stringify({ prompt: "ignored" }),
    })
    assert.equal(unauthorized.status, 401)

    const delivered = await fetch(`${runtime.endpoint}/context`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify({
        version: 1,
        source: "vscode",
        prompt: "@src/example.ts#L1C1",
      }),
    })
    assert.equal(delivered.status, 200)
    assert.deepEqual(deliveredPrompts, ["@src/example.ts#L1C1"])

    const firefoxContext = await fetch(`${runtime.endpoint}/context`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify({
        version: 1,
        source: "firefox",
        prompt: "github selection",
        metadata: {
          url: "https://github.com/example/repo/pull/1/files#diff-abcR53",
          title: "Pull request",
        },
      }),
    })
    assert.equal(firefoxContext.status, 200)
    assert.deepEqual(deliveredPrompts, ["@src/example.ts#L1C1", "github selection"])

    for (const body of [
      { prompt: "legacy" },
      { version: 2, source: "vscode", prompt: "unsupported" },
      { version: 1, source: "unknown", prompt: "unsupported" },
      { version: 1, source: "firefox", prompt: "unsupported", metadata: [] },
    ]) {
      const invalid = await fetch(`${runtime.endpoint}/context`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${state.token}`,
        },
        body: JSON.stringify(body),
      })
      assert.equal(invalid.status, 400)
    }
    assert.deepEqual(deliveredPrompts, ["@src/example.ts#L1C1", "github selection"])

    await runtime.close()
    await assert.rejects(fs.stat(stateFile))
  } finally {
    await runtime.close()
    await fs.rm(directory, { recursive: true, force: true })
  }
})
