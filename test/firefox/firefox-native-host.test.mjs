import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { createServer } from "node:http"

import { createBridgeRuntime } from "../../omp/bridge-runtime.js"
import {
  assertEnvelope,
  deliverEnvelope,
  encodeMessage,
} from "../../firefox/native-host/omp-send-context-host.mjs"

async function availableServer(handler) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  return server
}

function serverPort(server) {
  return server.address().port
}

async function closeServer(server) {
  await new Promise((resolve) => {
    server.close(resolve)
    server.closeAllConnections?.()
  })
}

async function availablePort() {
  const server = await availableServer()
  const port = serverPort(server)
  await closeServer(server)
  return port
}

async function createStateDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-send-context-host-"))
  return {
    stateFile: path.join(directory, "agent", "editor-context-bridge.json"),
    async cleanup() {
      await fs.rm(directory, { recursive: true, force: true })
    },
  }
}

function createRuntime(stateFile, delivered, defaultPort = 0) {
  return createBridgeRuntime({
    deliverPrompt(prompt) {
      delivered.push(prompt)
    },
    notify() {},
    packageFile: path.resolve("package.json"),
    stateFile,
    defaultPort,
  })
}

function runNativeHost(envelope, stateFile) {
  const child = spawn(process.execPath, ["firefox/native-host/omp-send-context-host.mjs"], {
    env: { ...process.env, OMP_CONTEXT_STATE_FILE: stateFile },
    stdio: ["pipe", "pipe", "pipe"],
  })
  const output = new Promise((resolve, reject) => {
    const chunks = []
    const errors = []
    child.stdout.on("data", (chunk) => chunks.push(chunk))
    child.stderr.on("data", (chunk) => errors.push(chunk))
    child.on("error", reject)
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(errors).toString("utf8") || `Native host exited ${code}`))
        return
      }
      try {
        resolve(decodeFrames(Buffer.concat(chunks)))
      } catch (error) {
        reject(error)
      }
    })
  })
  child.stdin.end(encodeMessage(envelope))
  return output
}

function decodeFrames(buffer) {
  const messages = []
  let offset = 0
  while (offset < buffer.length) {
    if (buffer.length - offset < 4) {
      throw new Error("Incomplete native host response frame")
    }
    const length = buffer.readUInt32LE(offset)
    const frameEnd = offset + 4 + length
    if (frameEnd > buffer.length) {
      throw new Error("Incomplete native host response frame")
    }
    messages.push(JSON.parse(buffer.subarray(offset + 4, frameEnd).toString("utf8")))
    offset = frameEnd
  }
  return messages
}

test("when a framed context arrives, the native host delivers it with the bridge identity", async () => {
  // Arrange
  const fixture = await createStateDirectory()
  const instanceId = "native-frame-owner"
  const token = "test-token"
  const prompt = "# OMP Agent Handoff\n\n## GitHub\n\nselected"
  const envelope = {
    version: 1,
    source: "firefox",
    prompt,
    metadata: { url: "https://github.com/org/repo/pull/1" },
  }
  let received
  const server = await availableServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ instanceId }))
      return
    }
    if (request.method === "POST" && request.url === "/context") {
      received = {
        authorization: request.headers.authorization,
        instanceId: request.headers["x-omp-instance-id"],
        body: JSON.parse(await readRequest(request)),
      }
      response.writeHead(200)
      response.end(JSON.stringify({ ok: true }))
      return
    }
    response.writeHead(404)
    response.end()
  })

  try {
    await fs.mkdir(path.dirname(fixture.stateFile), { recursive: true })
    await fs.writeFile(
      fixture.stateFile,
      JSON.stringify({
        endpoint: `http://127.0.0.1:${serverPort(server)}`,
        token,
        instanceId,
        pid: process.pid,
        claimedAt: Date.now(),
        updatedAt: new Date().toISOString(),
      })
    )

    // Act
    const responses = await runNativeHost(envelope, fixture.stateFile)

    // Assert
    assert.deepEqual(responses, [{ ok: true }])
    assert.deepEqual(received, {
      authorization: `Bearer ${token}`,
      instanceId,
      body: envelope,
    })
  } finally {
    await closeServer(server)
    await fixture.cleanup()
  }
})

test("when an envelope or bridge endpoint is invalid, the native host rejects it", async () => {
  // Arrange
  const fixture = await createStateDirectory()

  try {
    await fs.mkdir(path.dirname(fixture.stateFile), { recursive: true })
    await fs.writeFile(
      fixture.stateFile,
      JSON.stringify({
        endpoint: "https://example.com",
        token: "secret",
        instanceId: "invalid-owner",
        pid: process.pid,
        claimedAt: Date.now(),
      })
    )
    const invalidEnvelope = { prompt: "legacy" }
    const invalidMetadata = { version: 1, source: "firefox", prompt: "x", metadata: [] }
    const oversizedEnvelope = {
      version: 1,
      source: "firefox",
      prompt: "x".repeat(2_100_000),
    }
    const validEnvelope = { version: 1, source: "firefox", prompt: "context" }

    // Act
    const invalidBridgeDelivery = deliverEnvelope(validEnvelope, { stateFile: fixture.stateFile })

    // Assert
    assert.throws(() => assertEnvelope(invalidEnvelope), /version 1/)
    assert.throws(() => assertEnvelope(invalidMetadata), /object metadata/)
    assert.throws(() => assertEnvelope(oversizedEnvelope), /too large/)
    await assert.rejects(invalidBridgeDelivery, /No healthy OMP bridge is available/)
  } finally {
    await fixture.cleanup()
  }
})

test("when the pointer trails the registry claim, delivery reaches the latest claimed console", async () => {
  // Arrange
  const fixture = await createStateDirectory()
  const earlierDelivered = []
  const selectedDelivered = []
  const earlier = createRuntime(fixture.stateFile, earlierDelivered)
  const selected = createRuntime(fixture.stateFile, selectedDelivered)
  const prompt = "manual selection after /ide"

  try {
    await earlier.start()
    await earlier.claim({ force: true, claimedAt: Date.now() })
    const stalePointerState = JSON.parse(await fs.readFile(fixture.stateFile, "utf8"))

    await selected.start()
    await selected.claim({ force: true, claimedAt: stalePointerState.claimedAt + 1_000 })
    await fs.writeFile(fixture.stateFile, JSON.stringify(stalePointerState), { mode: 0o600 })

    // Act
    await deliverEnvelope(
      { version: 1, source: "firefox", prompt },
      { stateFile: fixture.stateFile }
    )

    // Assert
    assert.deepEqual(earlierDelivered, [])
    assert.deepEqual(selectedDelivered, [prompt])
  } finally {
    await Promise.all([earlier.close(), selected.close()])
    await fixture.cleanup()
  }
})

test("when dead and reused registry owners remain, delivery reaches the restarted console", async () => {
  // Arrange
  const fixture = await createStateDirectory()
  const originalDelivered = []
  const restartedDelivered = []
  const reusedPort = await availablePort()
  const original = createRuntime(fixture.stateFile, originalDelivered, reusedPort)
  const restarted = createRuntime(fixture.stateFile, restartedDelivered, reusedPort)
  const prompt = "context for the restarted console"

  try {
    await original.start()
    await original.claim({ force: true, claimedAt: Date.now() })
    const staleState = JSON.parse(await fs.readFile(fixture.stateFile, "utf8"))
    await original.close()

    await restarted.start()
    await restarted.claim({ force: true, claimedAt: staleState.claimedAt + 1_000 })
    const restartedState = JSON.parse(await fs.readFile(fixture.stateFile, "utf8"))
    const registryDirectory = `${fixture.stateFile}.d`

    await fs.writeFile(
      path.join(registryDirectory, `${staleState.instanceId}.json`),
      JSON.stringify({ ...staleState, claimedAt: restartedState.claimedAt + 1_000 }),
      { mode: 0o600 }
    )
    const deadState = {
      endpoint: `http://127.0.0.1:${await availablePort()}`,
      token: "dead-token",
      instanceId: "dead-owner",
      pid: 1_073_741_824,
      claimedAt: restartedState.claimedAt + 2_000,
    }
    await fs.writeFile(path.join(registryDirectory, "dead-owner.json"), JSON.stringify(deadState), {
      mode: 0o600,
    })
    await fs.writeFile(fixture.stateFile, JSON.stringify(deadState), { mode: 0o600 })

    // Act
    await deliverEnvelope(
      { version: 1, source: "firefox", prompt },
      { stateFile: fixture.stateFile }
    )

    // Assert
    assert.equal(restartedState.endpoint, staleState.endpoint)
    assert.notEqual(restartedState.instanceId, staleState.instanceId)
    assert.deepEqual(originalDelivered, [])
    assert.deepEqual(restartedDelivered, [prompt])
  } finally {
    await Promise.all([original.close(), restarted.close()])
    await fixture.cleanup()
  }
})

test("when selection changes after discovery, native delivery rejects the stale console", async () => {
  // Arrange
  const fixture = await createStateDirectory()
  const staleDelivered = []
  const selectedDelivered = []
  const stale = createRuntime(fixture.stateFile, staleDelivered)
  const selected = createRuntime(fixture.stateFile, selectedDelivered)
  try {
    await stale.start()
    await stale.claim({ force: true })
    await selected.start()

    // Act
    const delivery = deliverEnvelope(
      { version: 1, source: "firefox", prompt: "must not paste into a stale selection" },
      {
        stateFile: fixture.stateFile,
        async fetchImpl(endpoint, options) {
          await selected.claim({ force: true })
          return fetch(endpoint, options)
        },
      }
    )

    // Assert
    await assert.rejects(delivery, /OMP bridge returned 409/)
    assert.deepEqual(staleDelivered, [])
    assert.deepEqual(selectedDelivered, [])
  } finally {
    await Promise.all([stale.close(), selected.close()])
    await fixture.cleanup()
  }
})

test("when latest bridge health is ambiguous, one error is returned without older delivery", async () => {
  // Arrange
  const fixture = await createStateDirectory()
  const olderDelivered = []
  const older = createRuntime(fixture.stateFile, olderDelivered)
  let latestPosts = 0
  let ambiguousServer
  const prompt = "must not reach the older console"

  try {
    await older.start()
    await older.claim({ force: true, claimedAt: Date.now() })
    const olderState = JSON.parse(await fs.readFile(fixture.stateFile, "utf8"))
    ambiguousServer = await availableServer((request, response) => {
      if (request.method === "GET" && request.url === "/health") {
        response.writeHead(503)
        response.end()
        return
      }
      if (request.method === "POST") {
        latestPosts += 1
      }
      response.writeHead(200)
      response.end()
    })
    const ambiguousState = {
      endpoint: `http://127.0.0.1:${serverPort(ambiguousServer)}`,
      token: "ambiguous-token",
      instanceId: "ambiguous-owner",
      pid: process.pid,
      claimedAt: olderState.claimedAt + 1_000,
    }
    const registryDirectory = `${fixture.stateFile}.d`
    await fs.writeFile(
      path.join(registryDirectory, "ambiguous-owner.json"),
      JSON.stringify(ambiguousState),
      { mode: 0o600 }
    )
    await fs.writeFile(fixture.stateFile, JSON.stringify(ambiguousState), { mode: 0o600 })

    // Act
    const responses = await runNativeHost(
      { version: 1, source: "firefox", prompt },
      fixture.stateFile
    )

    // Assert
    assert.deepEqual(responses, [{ ok: false, error: "No healthy OMP bridge is available" }])
    assert.equal(latestPosts, 0)
    assert.deepEqual(olderDelivered, [])
  } finally {
    if (ambiguousServer !== undefined) {
      await closeServer(ambiguousServer)
    }
    await older.close()
    await fixture.cleanup()
  }
})

function readRequest(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on("data", (chunk) => chunks.push(chunk))
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    request.on("error", reject)
  })
}
