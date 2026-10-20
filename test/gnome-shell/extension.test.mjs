import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const hasGjs = spawnSync("gjs", ["--version"]).status === 0
const worker = fileURLToPath(new URL("./extension-client.js", import.meta.url))
const extensionSource = fileURLToPath(import.meta.resolve("#root/gnome-shell/extension.js"))

async function writeBridgeState(t, contents) {
  const home = await mkdtemp(join(tmpdir(), "omp-gnome-extension-"))
  t.after(() => rm(home, { recursive: true, force: true }))
  const directory = join(home, ".omp", "agent")
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, "editor-context-bridge.json"), contents, { mode: 0o600 })
  return home
}

function startExtensionClient(home, action) {
  const child = spawn("gjs", ["-m", worker, action, extensionSource], {
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

describe("OmpSendContextExtension in GJS", { skip: !hasGjs, timeout: 5000 }, () => {
  test("when bridge-state reading fails after re-enable, no stale failure is logged or shown", async (t) => {
    // Arrange
    const home = await writeBridgeState(t, "not valid JSON")
    const { child, completion } = startExtensionClient(home, "stale-read-failure")
    t.after(() => {
      if (child.exitCode === null) {
        child.kill()
      }
    })

    // Act
    const result = await completion

    // Assert
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), {
      notifications: [],
      loggedErrors: [],
    })
  })

  test("when sending fails after re-enable, no stale failure is logged or shown", async (t) => {
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
    const home = await writeBridgeState(
      t,
      JSON.stringify({
        endpoint: `http://127.0.0.1:${server.address().port}`,
        token: "test-token",
      })
    )
    const { child, completion } = startExtensionClient(home, "stale-send-failure")
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
    assert.deepEqual(JSON.parse(result.stdout), {
      notifications: [],
      loggedErrors: [],
    })
    assert.equal(requestCount, 1)
  })
})
