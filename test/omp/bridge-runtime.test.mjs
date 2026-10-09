import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createServer } from "node:http"
import { performance } from "node:perf_hooks"

import { resolveBridgeState } from "../../omp/bridge-discovery.js"
import { createBridgeRuntime } from "../../omp/bridge-runtime.js"

const PACKAGE_FILE = path.resolve("package.json")
const ENVELOPE = {
  version: 1,
  source: "vscode",
  prompt: "@src/example.ts#L1C1",
}

async function availablePort() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address()
  await closeServer(server)
  return port
}

async function reservePortRange(size) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const firstPort = await availablePort()
    const servers = []
    try {
      for (let offset = 0; offset < size; offset += 1) {
        const server = createServer()
        await new Promise((resolve, reject) => {
          server.once("error", reject)
          server.listen(firstPort + offset, "127.0.0.1", resolve)
        })
        servers.push(server)
      }
      return { firstPort, servers }
    } catch {
      await Promise.all(servers.map(closeServer))
    }
  }
  throw new Error(`Could not reserve ${size} consecutive local ports`)
}

async function closeServer(server) {
  await new Promise((resolve) => {
    server.close(resolve)
    server.closeAllConnections?.()
  })
}

async function createStateDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-send-context-runtime-"))
  return {
    directory,
    stateFile: path.join(directory, "agent", "editor-context-bridge.json"),
    async cleanup() {
      await fs.rm(directory, { recursive: true, force: true })
    },
  }
}

function createRuntime(stateFile, { delivered = [], defaultPort = 0, onNotify = () => {} } = {}) {
  return createBridgeRuntime({
    deliverPrompt(prompt) {
      delivered.push(prompt)
    },
    notify: onNotify,
    packageFile: PACKAGE_FILE,
    stateFile,
    defaultPort,
  })
}

async function postContext(state, { instanceId, prompt = ENVELOPE.prompt } = {}) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${state.token}`,
  }
  if (instanceId !== undefined) {
    headers["X-OMP-Instance-Id"] = instanceId
  }
  return fetch(`${state.endpoint}/context`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...ENVELOPE, prompt }),
  })
}

test("bridge runtime owns HTTP delivery and state lifecycle", async () => {
  const fixture = await createStateDirectory()
  const deliveredPrompts = []
  const runtime = createRuntime(fixture.stateFile, {
    delivered: deliveredPrompts,
    defaultPort: await availablePort(),
  })

  try {
    await runtime.start()
    assert.equal(await runtime.claim({ force: true }), true)

    const state = JSON.parse(await fs.readFile(fixture.stateFile, "utf8"))
    assert.equal(state.endpoint, runtime.endpoint)
    assert.equal(state.version, runtime.version)
    assert.equal(state.claimedAt, runtime.claimedAt)

    const directoryStats = await fs.stat(`${fixture.stateFile}.d`)
    const recordStats = await fs.stat(`${fixture.stateFile}.d/${state.instanceId}.json`)
    assert.equal(directoryStats.mode & 0o777, 0o700)
    assert.equal(recordStats.mode & 0o777, 0o600)

    const health = await fetch(`${runtime.endpoint}/health`)
    assert.equal(health.status, 200)
    assert.equal((await health.json()).endpoint, runtime.endpoint)

    const unauthorized = await fetch(`${runtime.endpoint}/context`, {
      method: "POST",
      body: JSON.stringify({ prompt: "ignored" }),
    })
    assert.equal(unauthorized.status, 401)

    const delivered = await postContext(state)
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

    const ptyxisContext = await fetch(`${runtime.endpoint}/context`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify({
        version: 1,
        source: "ptyxis",
        prompt: "terminal selection",
        metadata: {
          application: "org.gnome.Ptyxis",
          title: "Terminal",
        },
      }),
    })
    assert.equal(ptyxisContext.status, 200)
    assert.deepEqual(deliveredPrompts, [
      "@src/example.ts#L1C1",
      "github selection",
      "terminal selection",
    ])

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
    assert.deepEqual(deliveredPrompts, [
      "@src/example.ts#L1C1",
      "github selection",
      "terminal selection",
    ])

    await runtime.close()
    await assert.rejects(fs.stat(fixture.stateFile))
    assert.deepEqual(await fs.readdir(`${fixture.stateFile}.d`), [])
  } finally {
    await runtime.close()
    await fixture.cleanup()
  }
})

test("unclaimed startup tie keeps the registry owner already named by the pointer", async () => {
  const fixture = await createStateDirectory()
  const first = createRuntime(fixture.stateFile)
  const second = createRuntime(fixture.stateFile)

  try {
    await first.start()
    const selectedBeforeSecondStart = await resolveBridgeState(fixture.stateFile)
    assert.equal(selectedBeforeSecondStart.claimedAt, 0)

    await second.start()
    assert.equal(second.claimedAt, 0)
    assert.equal(await second.claim(), false)
    assert.equal(
      (await resolveBridgeState(fixture.stateFile)).instanceId,
      selectedBeforeSecondStart.instanceId
    )
  } finally {
    await Promise.all([first.close(), second.close()])
    await fixture.cleanup()
  }
})

test("startup preserves the selected owner and close promotes the live survivor", async () => {
  const fixture = await createStateDirectory()
  const first = createRuntime(fixture.stateFile)
  const second = createRuntime(fixture.stateFile)
  const runtimes = [first, second]

  try {
    await first.start()
    assert.equal(await first.claim({ force: true }), true)
    const firstState = await resolveBridgeState(fixture.stateFile)

    await second.start()
    assert.equal(await second.claim(), false)
    assert.equal((await resolveBridgeState(fixture.stateFile)).instanceId, firstState.instanceId)

    assert.equal(await second.claim({ force: true }), true)
    const secondState = await resolveBridgeState(fixture.stateFile)
    assert.equal(
      JSON.parse(await fs.readFile(fixture.stateFile, "utf8")).instanceId,
      secondState.instanceId
    )
    assert.ok(secondState.claimedAt > firstState.claimedAt)
    await fs.writeFile(fixture.stateFile, JSON.stringify(firstState), { mode: 0o600 })
    assert.equal((await resolveBridgeState(fixture.stateFile)).instanceId, secondState.instanceId)

    await second.close()
    assert.equal((await resolveBridgeState(fixture.stateFile)).instanceId, firstState.instanceId)
  } finally {
    await Promise.all(runtimes.map((runtime) => runtime.close()))
    await fixture.cleanup()
  }
})

test("forced activity is visible synchronously and persists in invocation order", async () => {
  const fixture = await createStateDirectory()
  const runtime = createRuntime(fixture.stateFile)

  try {
    await runtime.start()
    const firstClaim = runtime.claim({ force: true })
    const firstActivity = runtime.claimedAt
    const secondClaim = runtime.claim({ force: true })
    const latestActivity = runtime.claimedAt

    assert.ok(latestActivity >= firstActivity)
    assert.equal(await firstClaim, true)
    assert.equal(await secondClaim, true)
    assert.equal(runtime.claimedAt, latestActivity)
    const selected = await resolveBridgeState(fixture.stateFile)
    const registryStateFile = `${fixture.stateFile}.d/${selected.instanceId}.json`
    const state = JSON.parse(await fs.readFile(registryStateFile, "utf8"))
    assert.equal(state.claimedAt, latestActivity)
  } finally {
    await runtime.close()
    await fixture.cleanup()
  }
})

test("a delayed startup event keeps its original activity ordering", async () => {
  const fixture = await createStateDirectory()
  const earlyConsole = createRuntime(fixture.stateFile)
  const laterConsole = createRuntime(fixture.stateFile)

  try {
    await earlyConsole.start()
    const eventTime = performance.timeOrigin + performance.now()

    await laterConsole.start()
    await laterConsole.claim({ force: true })
    const laterState = await resolveBridgeState(fixture.stateFile)
    assert.ok(laterState.claimedAt > eventTime)

    assert.equal(await earlyConsole.claim({ force: true, claimedAt: eventTime }), true)
    assert.equal(earlyConsole.claimedAt, eventTime)
    assert.equal((await resolveBridgeState(fixture.stateFile)).instanceId, laterState.instanceId)
  } finally {
    await Promise.all([earlyConsole.close(), laterConsole.close()])
    await fixture.cleanup()
  }
})

test("authenticated automatic delivery rejects stale identity while explicit routing stays pinned", async () => {
  const fixture = await createStateDirectory()
  const delivered = []
  const first = createRuntime(fixture.stateFile, { delivered })
  const second = createRuntime(fixture.stateFile, { delivered })

  try {
    await first.start()
    await first.claim({ force: true })
    const firstState = await resolveBridgeState(fixture.stateFile)
    const explicitFirst = await resolveBridgeState(fixture.stateFile, { endpoint: first.endpoint })
    assert.equal(explicitFirst.instanceId, firstState.instanceId)

    await second.start()
    await second.claim({ force: true })
    const secondState = await resolveBridgeState(fixture.stateFile)

    const staleAutomatic = await postContext(firstState, {
      instanceId: firstState.instanceId,
      prompt: "stale",
    })
    assert.equal(staleAutomatic.status, 409)
    assert.deepEqual(delivered, [])

    const selected = await postContext(secondState, {
      instanceId: secondState.instanceId,
      prompt: "selected",
    })
    assert.equal(selected.status, 200)
    assert.deepEqual(delivered, ["selected"])

    const explicitPinned = await postContext(firstState, { prompt: "explicit" })
    assert.equal(explicitPinned.status, 200)
    assert.deepEqual(delivered, ["selected", "explicit"])
  } finally {
    await Promise.all([first.close(), second.close()])
    await fixture.cleanup()
  }
})

test("dead registry owners are skipped in favor of the live survivor", async () => {
  const fixture = await createStateDirectory()
  const survivor = createRuntime(fixture.stateFile)

  try {
    await survivor.start()
    await survivor.claim({ force: true })
    const survivorState = await resolveBridgeState(fixture.stateFile)
    const deadState = {
      endpoint: `http://127.0.0.1:${await availablePort()}`,
      port: 1,
      token: "dead-token",
      pid: 999999,
      instanceId: "dead-owner",
      version: "old",
      updatedAt: new Date().toISOString(),
      claimedAt: survivorState.claimedAt + 1,
    }
    await fs.mkdir(`${fixture.stateFile}.d`, { recursive: true, mode: 0o700 })
    await fs.writeFile(`${fixture.stateFile}.d/dead-owner.json`, JSON.stringify(deadState), {
      mode: 0o600,
    })
    await fs.writeFile(fixture.stateFile, JSON.stringify(deadState), { mode: 0o600 })

    const selected = await resolveBridgeState(fixture.stateFile)
    assert.equal(selected.instanceId, survivorState.instanceId)
    assert.equal(JSON.parse(await fs.readFile(fixture.stateFile, "utf8")).instanceId, "dead-owner")
  } finally {
    await survivor.close()
    await fixture.cleanup()
  }
})

test("a timed-out latest owner blocks fallback to an older live console", async () => {
  const fixture = await createStateDirectory()
  const survivor = createRuntime(fixture.stateFile)
  let busyOwner

  try {
    await survivor.start()
    await survivor.claim({ force: true })
    const survivorState = await resolveBridgeState(fixture.stateFile)

    busyOwner = createServer(() => {})
    await new Promise((resolve) => busyOwner.listen(0, "127.0.0.1", resolve))
    const busyState = {
      endpoint: `http://127.0.0.1:${busyOwner.address().port}`,
      token: "busy-token",
      instanceId: "busy-owner",
      claimedAt: survivorState.claimedAt + 1,
    }
    await fs.writeFile(`${fixture.stateFile}.d/busy-owner.json`, JSON.stringify(busyState), {
      mode: 0o600,
    })
    await fs.writeFile(fixture.stateFile, JSON.stringify(busyState), { mode: 0o600 })

    assert.equal(await resolveBridgeState(fixture.stateFile), undefined)

    await closeServer(busyOwner)
    busyOwner = undefined
    await fs.rm(`${fixture.stateFile}.d/busy-owner.json`)
    await fs.writeFile(fixture.stateFile, JSON.stringify(survivorState), { mode: 0o600 })
    assert.equal((await resolveBridgeState(fixture.stateFile)).instanceId, survivorState.instanceId)
  } finally {
    if (busyOwner !== undefined) {
      await closeServer(busyOwner)
    }
    await survivor.close()
    await fixture.cleanup()
  }
})

test("legacy shared pointers remain discoverable and configured endpoints stay pinned", async () => {
  const fixture = await createStateDirectory()
  const runtime = createRuntime(fixture.stateFile)

  try {
    await runtime.start()
    await runtime.claim({ force: true })
    const legacyState = JSON.parse(await fs.readFile(fixture.stateFile, "utf8"))
    delete legacyState.claimedAt
    await fs.rm(`${fixture.stateFile}.d/${legacyState.instanceId}.json`)
    await fs.writeFile(fixture.stateFile, JSON.stringify(legacyState), { mode: 0o600 })

    const discovered = await resolveBridgeState(fixture.stateFile)
    assert.equal(discovered.instanceId, legacyState.instanceId)
    assert.equal(discovered.claimedAt, undefined)
    assert.equal(
      (await resolveBridgeState(fixture.stateFile, { endpoint: legacyState.endpoint })).instanceId,
      legacyState.instanceId
    )
    assert.equal(
      await resolveBridgeState(fixture.stateFile, { endpoint: "http://127.0.0.1:1" }),
      undefined
    )
  } finally {
    await runtime.close()
    await fixture.cleanup()
  }
})

test("a reused endpoint rejects stale credentials and health identity", async () => {
  const fixture = await createStateDirectory()
  const reusedPort = await availablePort()
  const delivered = []
  const oldRuntime = createRuntime(fixture.stateFile, { defaultPort: reusedPort })
  let replacement

  try {
    await oldRuntime.start()
    await oldRuntime.claim({ force: true })
    const staleState = JSON.parse(await fs.readFile(fixture.stateFile, "utf8"))
    await oldRuntime.close()

    replacement = createRuntime(fixture.stateFile, { defaultPort: reusedPort, delivered })
    await replacement.start()
    await replacement.claim({ force: true })
    const replacementState = await resolveBridgeState(fixture.stateFile)
    assert.notEqual(replacementState.instanceId, staleState.instanceId)
    assert.equal(replacementState.endpoint, staleState.endpoint)

    const stalePointerFile = path.join(fixture.directory, "stale-pointer.json")
    await fs.writeFile(stalePointerFile, JSON.stringify(staleState), { mode: 0o600 })
    assert.equal(await resolveBridgeState(stalePointerFile), undefined)

    const staleRequest = await postContext(staleState, {
      instanceId: staleState.instanceId,
      prompt: "stale",
    })
    assert.equal(staleRequest.status, 401)
    assert.deepEqual(delivered, [])

    const currentRequest = await postContext(replacementState, {
      instanceId: replacementState.instanceId,
      prompt: "current",
    })
    assert.equal(currentRequest.status, 200)
    assert.deepEqual(delivered, ["current"])
  } finally {
    await Promise.all([oldRuntime.close(), replacement?.close()])
    await fixture.cleanup()
  }
})

test("a seeded activity survives reload without outranking newer activity", async () => {
  const fixture = await createStateDirectory()
  const original = createRuntime(fixture.stateFile)
  let restarted
  const newerOwner = createRuntime(fixture.stateFile)

  try {
    await original.start()
    await original.claim({ force: true })
    const inheritedActivity = original.claimedAt
    await original.close()

    await newerOwner.start()
    await newerOwner.claim({ force: true })
    const newerOwnerId = (await resolveBridgeState(fixture.stateFile)).instanceId

    restarted = createBridgeRuntime({
      deliverPrompt() {},
      notify() {},
      packageFile: PACKAGE_FILE,
      stateFile: fixture.stateFile,
      defaultPort: 0,
    })
    await restarted.start({ claimedAt: inheritedActivity })
    assert.equal(restarted.claimedAt, inheritedActivity)
    assert.equal(await restarted.claim(), false)
    assert.equal((await resolveBridgeState(fixture.stateFile)).instanceId, newerOwnerId)

    await newerOwner.close()
    assert.equal((await resolveBridgeState(fixture.stateFile)).claimedAt, inheritedActivity)
  } finally {
    await Promise.all([original.close(), newerOwner.close(), restarted?.close()])
    await fixture.cleanup()
  }
})

test("a queued forced claim cannot resurrect registry state after shutdown", async () => {
  const fixture = await createStateDirectory()
  const survivor = createRuntime(fixture.stateFile)
  const closing = createRuntime(fixture.stateFile)

  try {
    await survivor.start()
    await survivor.claim({ force: true })
    const survivorId = (await resolveBridgeState(fixture.stateFile)).instanceId
    await closing.start()
    const pendingClaim = closing.claim({ force: true })
    const pendingClose = closing.close()
    assert.equal(await pendingClaim, true)
    await pendingClose

    const selected = await resolveBridgeState(fixture.stateFile)
    assert.equal(selected.instanceId, survivorId)
    const registryEntries = await fs.readdir(`${fixture.stateFile}.d`)
    assert.equal(registryEntries.length, 1)
    const pointer = JSON.parse(await fs.readFile(fixture.stateFile, "utf8"))
    assert.equal(pointer.instanceId, selected.instanceId)
  } finally {
    await Promise.all([survivor.close(), closing.close()])
    await fixture.cleanup()
  }
})

test("bridge falls back to an OS-assigned port after the preferred range is exhausted", async () => {
  const fixture = await createStateDirectory()
  const reserved = await reservePortRange(20)
  const runtime = createRuntime(fixture.stateFile, { defaultPort: reserved.firstPort })

  try {
    await runtime.start()
    assert.ok(runtime.endpoint)
    const runtimePort = Number(new URL(runtime.endpoint).port)
    assert.equal(
      reserved.servers.some((server) => server.address().port === runtimePort),
      false
    )
    assert.equal((await fetch(`${runtime.endpoint}/health`)).status, 200)
  } finally {
    await runtime.close()
    await Promise.all(reserved.servers.map(closeServer))
    await fixture.cleanup()
  }
})
