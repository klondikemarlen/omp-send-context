import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const STATE_FILE = ".omp/agent/editor-context-bridge.json"
const DIAGNOSTICS_DIRECTORY = ".omp/agent/send-context-diagnostics"

async function createHarness() {
  const originalHome = process.env.HOME
  const originalPort = process.env.OMP_CONTEXT_BRIDGE_PORT
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "omp-session-ownership-"))
  process.env.HOME = home
  process.env.OMP_CONTEXT_BRIDGE_PORT = "0"

  const lockFile = path.join(home, ".omp/plugins/omp-plugins.lock.json")
  await fs.mkdir(path.dirname(lockFile), { recursive: true })
  await fs.writeFile(
    lockFile,
    JSON.stringify({
      settings: { "omp-send-context": { claimIdeContextOnFocus: true, diagnostics: true } },
    })
  )

  const modulePath = process.env.OMP_SESSION_OWNERSHIP_EXTENSION ?? "omp/index.js"
  const moduleUrl = pathToFileURL(path.resolve(modulePath))
  moduleUrl.searchParams.set("session-ownership", `${process.pid}-${Date.now()}`)
  const extension = await import(moduleUrl.href)
  const registrations = []

  function register(name, { hasUI, agentKind } = {}) {
    const events = new Map()
    const commands = new Map()
    const terminalInputListeners = new Set()
    const api = {
      setLabel() {},
      registerFlag() {},
      getFlag() {
        return false
      },
      registerCommand(command, definition) {
        commands.set(command, definition)
      },
      on(event, handler) {
        const callbacks = events.get(event) ?? []
        callbacks.push(handler)
        events.set(event, callbacks)
      },
    }
    extension.default(api)
    const pasted = []
    const notified = []
    const context = {
      hasUI,
      agent: agentKind === undefined ? undefined : { kind: agentKind },
      sessionManager: { getSessionId: () => name },
      ui: {
        async pasteToEditor(prompt) {
          pasted.push(prompt)
        },
        notify(message) {
          notified.push(message)
        },
        onTerminalInput(handler) {
          terminalInputListeners.add(handler)
          return () => terminalInputListeners.delete(handler)
        },
      },
    }
    const registration = {
      name,
      events,
      commands,
      context,
      pasted,
      notified,
      terminalInputListeners,
    }
    registrations.push(registration)
    return registration
  }

  async function emit(registration, event, context = registration.context) {
    for (const handler of registration.events.get(event) ?? []) {
      await handler({}, context)
    }
  }

  return {
    home,
    registrations,
    register,
    emit,
    async close() {
      for (const registration of registrations) {
        await emit(registration, "session_shutdown")
      }
      process.env.HOME = originalHome
      if (originalPort === undefined) delete process.env.OMP_CONTEXT_BRIDGE_PORT
      else process.env.OMP_CONTEXT_BRIDGE_PORT = originalPort
      await fs.rm(home, { recursive: true, force: true })
    },
  }
}

async function readRegistry(home) {
  try {
    return JSON.parse(await fs.readFile(path.join(home, STATE_FILE), "utf8"))
  } catch (error) {
    if (error.code === "ENOENT") return undefined
    throw error
  }
}

async function readInstanceRecords(home) {
  const directory = path.join(home, `${STATE_FILE}.d`)
  const files = await fs.readdir(directory)
  return Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => JSON.parse(await fs.readFile(path.join(directory, file), "utf8")))
  )
}

async function readDiagnostics(home) {
  try {
    return await fs.readdir(path.join(home, DIAGNOSTICS_DIRECTORY))
  } catch (error) {
    if (error.code === "ENOENT") return []
    throw error
  }
}

async function postContext(record, prompt) {
  return fetch(`${record.endpoint}/context`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${record.token}`,
    },
    body: JSON.stringify({ version: 1, source: "vscode", prompt }),
  })
}

for (const childOrder of [
  ["child-one", "child-two"],
  ["child-two", "child-one"],
]) {
  test(`when headless siblings start and stop in ${childOrder.join(" then ")} order, UI ownership remains intact`, async () => {
    const harness = await createHarness()
    try {
      const main = harness.register("main", { hasUI: true })
      const children = new Map(
        childOrder.map((name) => [name, harness.register(name, { hasUI: false, agentKind: "sub" })])
      )
      // Arrange
      await harness.emit(main, "session_start")
      const mainRecord = await readRegistry(harness.home)
      assert.ok(mainRecord)
      const mainEndpoint = mainRecord.endpoint
      const mainInputListeners = main.terminalInputListeners.size
      const diagnostics = await readDiagnostics(harness.home)
      assert.ok(diagnostics.length > 0)

      // Act
      for (const child of children.values()) {
        await harness.emit(child, "session_start")
        await harness.emit(child, "session_switch")
        assert.equal((await readRegistry(harness.home)).endpoint, mainEndpoint)
        assert.equal(main.terminalInputListeners.size, mainInputListeners)
        assert.deepEqual(await readDiagnostics(harness.home), diagnostics)
      }

      for (const child of [...children.values()].reverse()) {
        await harness.emit(child, "session_shutdown")
        assert.equal((await readRegistry(harness.home)).endpoint, mainEndpoint)
        assert.equal(main.terminalInputListeners.size, mainInputListeners)
        assert.deepEqual(await readDiagnostics(harness.home), diagnostics)
      }

      // Assert
      const response = await postContext(mainRecord, "owned by main")
      assert.equal(response.status, 200)
      assert.deepEqual(main.pasted, ["owned by main", " "])
      assert.ok(main.terminalInputListeners.size > 0)
    } finally {
      await harness.close()
    }
  })
}

test("when subagent lifecycle events reach the main registration, its UI bridge remains owned", async () => {
  const harness = await createHarness()
  try {
    // Arrange
    const main = harness.register("main", { hasUI: true })
    const subagent = {
      ...main.context,
      hasUI: false,
      agent: { kind: "sub" },
      sessionManager: { getSessionId: () => "subagent" },
    }
    await harness.emit(main, "session_start")
    const mainRecord = await readRegistry(harness.home)

    // Act
    await harness.emit(main, "session_start", subagent)
    await harness.emit(main, "session_switch", subagent)
    await harness.emit(main, "session_shutdown", subagent)

    // Assert
    assert.equal((await readRegistry(harness.home)).endpoint, mainRecord.endpoint)
    const response = await postContext(mainRecord, "still delivered to UI")
    assert.equal(response.status, 200)
    assert.deepEqual(main.pasted, ["still delivered to UI", " "])
    assert.ok(main.terminalInputListeners.size > 0)
  } finally {
    await harness.close()
  }
})

test("when only a headless subagent registers, it creates no bridge, diagnostics, or input capture", async () => {
  const harness = await createHarness()
  const stdinListeners = process.stdin.listenerCount("data")
  try {
    // Arrange
    const child = harness.register("only-child", { hasUI: false, agentKind: "sub" })
    // Act
    await harness.emit(child, "session_start")
    await harness.emit(child, "session_switch")
    // Assert
    assert.equal(await readRegistry(harness.home), undefined)
    assert.deepEqual(await readDiagnostics(harness.home), [])
    assert.equal(process.stdin.listenerCount("data"), stdinListeners)
  } finally {
    await harness.close()
  }
})

test("when UI sessions register independently, shutting down one leaves the other bridge live", async () => {
  const harness = await createHarness()
  try {
    const first = harness.register("first-ui", { hasUI: true })
    const second = harness.register("second-ui", { hasUI: true })
    // Arrange
    await harness.emit(first, "session_start")
    const firstRecord = await readRegistry(harness.home)
    await harness.emit(second, "session_start")
    const records = await readInstanceRecords(harness.home)
    const selectedRecord = records.find((record) => record.endpoint !== firstRecord.endpoint)
    assert.ok(selectedRecord)
    assert.notEqual(firstRecord.endpoint, selectedRecord.endpoint)

    // Act
    await harness.emit(first, "session_shutdown")
    const response = await postContext(selectedRecord, "second remains live")

    // Assert
    assert.equal(response.status, 200)
    assert.deepEqual(second.pasted, ["second remains live", " "])
  } finally {
    await harness.close()
  }
})
