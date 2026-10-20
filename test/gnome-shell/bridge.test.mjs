import test from "node:test"
import assert from "node:assert/strict"
import { execFile, spawn, spawnSync } from "node:child_process"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execute = promisify(execFile)
const hasGjs = spawnSync("gjs", ["--version"]).status === 0
const worker = fileURLToPath(new URL("./bridge-client.js", import.meta.url))

async function writeBridgeState(t, state) {
  const home = await mkdtemp(join(tmpdir(), "omp-gnome-bridge-"))
  t.after(() => rm(home, { recursive: true, force: true }))
  const directory = join(home, ".omp", "agent")
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, "editor-context-bridge.json"), JSON.stringify(state), {
    mode: 0o600,
  })
  return home
}

function runClient(home, action = "read") {
  return execute("gjs", ["-m", worker, action], {
    env: { ...process.env, HOME: home },
    timeout: 5000,
  })
}

function startClient(home, action) {
  const child = spawn("gjs", ["-m", worker, action], {
    env: { ...process.env, HOME: home },
    stdio: ["pipe", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stdout.on("data", (chunk) => {
    stdout += chunk
  })
  child.stderr.on("data", (chunk) => {
    stderr += chunk
  })

  const completion = new Promise((resolve) => {
    child.on("error", (error) => resolve({ error, code: null, stdout, stderr }))
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
  return { child, completion }
}

test(
  "when GJS reads valid bridge state, it delivers the authenticated selection",
  { skip: !hasGjs },
  async (t) => {
    // Arrange
    const requests = []
    const server = createServer(async (request, response) => {
      const chunks = []
      for await (const chunk of request) {
        chunks.push(chunk)
      }
      requests.push({
        path: request.url,
        authorization: request.headers.authorization,
        envelope: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      })
      response.writeHead(200, { "Content-Type": "application/json" })
      response.end('{"ok":true}')
    })
    t.after(() => new Promise((resolve) => server.close(resolve)))
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    const home = await writeBridgeState(t, {
      endpoint: `http://127.0.0.1:${server.address().port}/ignored-path?ignored-query`,
      token: "test-token",
    })

    // Act
    await runClient(home, "send")

    // Assert
    assert.deepEqual(requests, [
      {
        path: "/context",
        authorization: "Bearer test-token",
        envelope: { version: 1, source: "ptyxis", prompt: "Native GJS bridge selection" },
      },
    ])
  }
)

test(
  "when GJS sends after closing its bridge client, it reports a closed-client error",
  { skip: !hasGjs },
  async (t) => {
    // Arrange
    const home = await writeBridgeState(t, {
      endpoint: "http://127.0.0.1:47687",
      token: "test-token",
    })

    // Act
    const sending = runClient(home, "send-closed")

    // Assert
    await assert.rejects(sending, (error) => error.stderr.includes("OMP bridge client is closed."))
  }
)

test(
  "when GJS closes after the bridge accepts a request, Soup cancels the send safely",
  { skip: !hasGjs, timeout: 5000 },
  async (t) => {
    // Arrange
    let requestCount = 0
    let receiveRequest
    const requestReceived = new Promise((resolve) => {
      receiveRequest = resolve
    })
    const server = createServer((request) => {
      requestCount += 1
      request.on("end", receiveRequest)
      request.resume()
    })
    t.after(() => {
      server.closeAllConnections()
      return new Promise((resolve) => server.close(resolve))
    })
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    const home = await writeBridgeState(t, {
      endpoint: `http://127.0.0.1:${server.address().port}`,
      token: "test-token",
    })
    const { child, completion } = startClient(home, "close-during-send")
    t.after(() => {
      if (child.exitCode === null) {
        child.kill()
      }
    })

    // Act
    const firstOutcome = await Promise.race([
      requestReceived.then(() => "request received"),
      completion.then(() => "client exited before the request arrived"),
    ])
    if (firstOutcome === "request received") {
      child.stdin.end("x")
    }
    const result = await completion

    // Assert
    assert.equal(firstOutcome, "request received")
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.stdout.trim(), "send-cancelled")
    assert.equal(requestCount, 1)
  }
)

test(
  "when OMP returns an unsuccessful status, GJS reports the bridge error",
  { skip: !hasGjs },
  async (t) => {
    // Arrange
    let requestCount = 0
    const server = createServer((request, response) => {
      requestCount += 1
      request.resume()
      response.writeHead(503)
      response.end()
    })
    t.after(() => new Promise((resolve) => server.close(resolve)))
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    const home = await writeBridgeState(t, {
      endpoint: `http://127.0.0.1:${server.address().port}`,
      token: "test-token",
    })

    // Act
    const sending = runClient(home, "send")

    // Assert
    await assert.rejects(sending, (error) => error.stderr.includes("OMP bridge returned 503"))
    assert.equal(requestCount, 1)
  }
)

for (const { condition, state } of [
  {
    condition: "the endpoint is not loopback",
    state: { endpoint: "http://example.com:47687", token: "test-token" },
  },
  {
    condition: "the endpoint is not HTTP",
    state: { endpoint: "https://127.0.0.1:47687", token: "test-token" },
  },
  {
    condition: "the endpoint has no explicit port",
    state: { endpoint: "http://127.0.0.1", token: "test-token" },
  },
  {
    condition: "the endpoint port is malformed",
    state: { endpoint: "http://127.0.0.1:not-a-port", token: "test-token" },
  },
  {
    condition: "the bridge token is missing",
    state: { endpoint: "http://127.0.0.1:47687" },
  },
]) {
  test(`when ${condition}, GJS rejects the bridge state`, { skip: !hasGjs }, async (t) => {
    // Arrange
    const home = await writeBridgeState(t, state)

    // Act
    const reading = runClient(home)

    // Assert
    await assert.rejects(reading, (error) => error.code === 1)
  })
}
