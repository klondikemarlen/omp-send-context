import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createServer } from "node:http"
import { pathToFileURL } from "node:url"
import { syncBuiltinESMExports } from "node:module"
import { performance } from "node:perf_hooks"

import { createBridgeRuntime } from "#root/omp/bridge-runtime.js"

const BASE_PORT = 48731

async function withBridge(
  port,
  run,
  { flags = {}, pluginSettings = {}, platform = process.platform } = {}
) {
  const originalHome = process.env.HOME
  const originalPort = process.env.OMP_CONTEXT_BRIDGE_PORT
  const homeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-send-context-"))
  process.env.HOME = homeDirectory
  process.env.OMP_CONTEXT_BRIDGE_PORT = String(port)
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")
  Object.defineProperty(process, "platform", { ...originalPlatform, value: platform })
  const pluginsLockFile = path.join(homeDirectory, ".omp", "plugins", "omp-plugins.lock.json")
  await fs.mkdir(path.dirname(pluginsLockFile), {
    recursive: true,
  })
  await fs.writeFile(
    pluginsLockFile,
    JSON.stringify({
      settings: {
        "omp-send-context": pluginSettings,
      },
    })
  )

  const handlers = new Map()
  const commands = new Map()
  const sentMessages = []
  const terminalWrites = []
  const originalStdoutWrite = process.stdout.write
  process.stdout.write = (data) => {
    terminalWrites.push(String(data))
    return true
  }

  try {
    let loadCount = 0

    async function loadExtension() {
      const moduleUrl = pathToFileURL(path.resolve("omp/index.js"))
      const extensionModule = await import(
        `${moduleUrl.href}?bridge-test=${port}-${Date.now()}-${loadCount++}`
      )
      extensionModule.default(extensionApi)
    }

    const extensionApi = {
      registerFlag() {},
      getFlag(name) {
        return flags[name]
      },
      setLabel() {},
      on(eventName, handler) {
        handlers.set(eventName, handler)
      },
      registerCommand(commandName, command) {
        commands.set(commandName, command)
      },
      async sendUserMessage(prompt, options) {
        sentMessages.push({ prompt, options })
      },
    }
    await loadExtension()

    await run({
      commands,
      handlers,
      homeDirectory,
      sentMessages,
      stateFile: path.join(homeDirectory, ".omp", "agent", "editor-context-bridge.json"),
      terminalWrites,
      pluginsLockFile,
      async reloadExtension(beforeLoad = async () => {}) {
        await handlers.get("session_shutdown")?.()
        await beforeLoad()
        await loadExtension()
      },
    })
  } finally {
    await handlers.get("session_shutdown")?.()
    process.env.HOME = originalHome
    if (originalPort === undefined) {
      delete process.env.OMP_CONTEXT_BRIDGE_PORT
    } else {
      process.env.OMP_CONTEXT_BRIDGE_PORT = originalPort
    }
    Object.defineProperty(process, "platform", originalPlatform)
    process.stdout.write = originalStdoutWrite
    await fs.rm(homeDirectory, {
      recursive: true,
      force: true,
    })
  }
}

async function waitFor(check) {
  const deadline = Date.now() + 1000
  while (!(await check())) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for bridge focus claim")
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function postContext(state, { prompt, source = "vscode", metadata }) {
  return fetch(`${state.endpoint}/context`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.token}`,
    },
    body: JSON.stringify({
      version: 1,
      source,
      prompt,
      ...(metadata === undefined ? {} : { metadata }),
    }),
  })
}

test("when authorized context arrives, the bridge pastes it into the editor", async () => {
  await withBridge(BASE_PORT, async ({ handlers, stateFile }) => {
    // Arrange
    const pastedPrompts = []
    const context = {
      hasUI: true,
      ui: {
        async pasteToEditor(prompt) {
          pastedPrompts.push(prompt)
        },
      },
    }
    await handlers.get("session_start")({}, context)
    const state = JSON.parse(await fs.readFile(stateFile, "utf8"))

    // Act
    const response = await postContext(state, {
      prompt: "@src/example.ts#L1C1",
    })
    const spacedResponse = await postContext(state, {
      prompt: "@src/with-space.ts#L1C1 ",
    })

    // Assert
    assert.equal(response.status, 200)
    assert.equal(spacedResponse.status, 200)
    assert.deepEqual(pastedPrompts, ["@src/example.ts#L1C1", " ", "@src/with-space.ts#L1C1 "])
  })
})

test("when /ide status runs, it reports the loaded version and this console's endpoint", async () => {
  await withBridge(BASE_PORT + 37, async ({ commands, handlers, stateFile }) => {
    // Arrange
    const notifications = []
    const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"))
    const context = {
      hasUI: true,
      ui: {
        notify(message) {
          notifications.push(message)
        },
      },
    }
    await handlers.get("session_start")({}, context)
    const state = JSON.parse(await fs.readFile(stateFile, "utf8"))

    // Act
    await commands.get("ide").handler("status", context)

    // Assert
    assert.ok(notifications[0].includes(state.endpoint))
    assert.ok(notifications[0].includes(packageJson.version))
  })
})

test("when a structured Markdown prompt arrives, the bridge adds an edit separator", async () => {
  await withBridge(BASE_PORT + 23, async ({ handlers, stateFile }) => {
    // Arrange
    const pastedPrompts = []
    const markdownPrompt = [
      "# OMP Agent Handoff",
      "",
      "## Goal / constraints / verify with",
      "Goal: preserve exact packet body",
      "Verify with: targeted bridge test",
      "",
      "## Active editor",
      "@src/example.ts#L1C1-L2C3 ",
      "",
      "```ts",
      "const value = 1",
      "```",
      "",
      "",
    ].join("\n")

    await handlers.get("session_start")(
      {},
      {
        hasUI: true,
        ui: {
          async pasteToEditor(prompt) {
            pastedPrompts.push(prompt)
          },
        },
      }
    )

    const state = JSON.parse(await fs.readFile(stateFile, "utf8"))
    // Act
    const response = await postContext(state, {
      prompt: markdownPrompt,
    })

    // Assert
    assert.equal(response.status, 200)
    assert.deepEqual(pastedPrompts, [markdownPrompt, " "])
  })
})

test("when prompt paste is unavailable, the bridge appends through setEditorText", async () => {
  await withBridge(BASE_PORT + 22, async ({ handlers, stateFile }) => {
    // Arrange
    let editorText = "draft "

    await handlers.get("session_start")(
      {},
      {
        hasUI: true,
        ui: {
          async getEditorText() {
            return editorText
          },
          async setEditorText(text) {
            editorText = text
          },
        },
      }
    )

    const state = JSON.parse(await fs.readFile(stateFile, "utf8"))
    // Act
    const response = await postContext(state, {
      prompt: "@src/example.ts#L1C1",
    })

    // Assert
    assert.equal(response.status, 200)
    assert.equal(editorText, "draft @src/example.ts#L1C1 ")
  })
})

test("when the OMP prompt editor is unavailable, the bridge rejects context", async () => {
  await withBridge(BASE_PORT + 21, async ({ handlers, sentMessages, stateFile }) => {
    // Arrange
    await handlers.get("session_start")(
      {},
      {
        hasUI: false,
      }
    )

    const state = JSON.parse(await fs.readFile(stateFile, "utf8"))
    // Act
    const response = await postContext(state, {
      prompt: "@src/example.ts#L1C1 ",
    })
    const body = await response.json()

    // Assert
    assert.equal(response.status, 500)
    assert.equal(body.error, "No active OMP prompt editor available")
    assert.deepEqual(sentMessages, [])
  })
})

test("when another live bridge owns the claim, session_start does not steal it", async () => {
  await withBridge(BASE_PORT + 5, async ({ handlers, stateFile }) => {
    // Arrange
    const ownerPort = BASE_PORT + 6
    const ownerServer = createServer((_request, response) => {
      response.writeHead(200, {
        "Content-Type": "application/json",
      })
      response.end(JSON.stringify({ ok: true, instanceId: "owner-instance" }))
    })
    await new Promise((resolve) => ownerServer.listen(ownerPort, "127.0.0.1", resolve))

    try {
      await fs.mkdir(path.dirname(stateFile), {
        recursive: true,
      })
      await fs.writeFile(
        stateFile,
        JSON.stringify({
          endpoint: `http://127.0.0.1:${ownerPort}`,
          token: "owner-token",
          instanceId: "owner-instance",
        })
      )

      // Act
      await handlers.get("session_start")(
        {},
        {
          hasUI: true,
          ui: {
            notify() {},
          },
        }
      )

      // Assert
      const state = JSON.parse(await fs.readFile(stateFile, "utf8"))
      assert.equal(state.instanceId, "owner-instance")
    } finally {
      await new Promise((resolve) => ownerServer.close(resolve))
    }
  })
})

test("when shutdown races with a successor claim, it cannot delete that claim", async () => {
  const originalRename = fs.rename
  // Arrange
  let stateFile
  let releaseRename
  const allowRename = new Promise((resolve) => {
    releaseRename = resolve
  })
  let renameReachedResolve
  let renameReachedReject
  const renameReached = new Promise((resolve, reject) => {
    renameReachedResolve = resolve
    renameReachedReject = reject
  })
  let renameTimeout

  fs.rename = async (source, destination) => {
    if (source === stateFile && String(destination).includes(".closing")) {
      renameReachedResolve()
      await allowRename
    }
    return originalRename(source, destination)
  }
  syncBuiltinESMExports()

  // Act
  try {
    await withBridge(BASE_PORT + 10, async ({ handlers, stateFile: bridgeStateFile }) => {
      stateFile = bridgeStateFile
      await handlers.get("session_start")(
        {},
        {
          hasUI: true,
          ui: {},
        }
      )

      // Pause after the shutdown has confirmed ownership but before its atomic move.
      const shutdown = handlers.get("session_shutdown")()
      renameTimeout = setTimeout(() => {
        renameReachedReject(new Error("cleanup rename was not reached"))
      }, 1000)
      await renameReached
      clearTimeout(renameTimeout)

      const successorState = {
        endpoint: "http://127.0.0.1:49875",
        instanceId: "successor-instance",
      }
      const successorStateFile = `${stateFile}.successor`
      await fs.writeFile(successorStateFile, JSON.stringify(successorState))
      await originalRename(successorStateFile, stateFile)
      releaseRename()
      await shutdown

      // Assert
      assert.deepEqual(JSON.parse(await fs.readFile(stateFile, "utf8")), successorState)
    })
  } finally {
    fs.rename = originalRename
    syncBuiltinESMExports()
  }
})

test("when running on Linux with defaults, focus routing is enabled", async () => {
  await withBridge(BASE_PORT + 6, async ({ handlers }) => {
    // Arrange
    let subscribed = false
    // Act
    await handlers.get("session_start")(
      {},
      {
        hasUI: true,
        ui: {
          onTerminalInput() {
            subscribed = true
            return () => {}
          },
        },
      }
    )
    // Assert
    assert.equal(subscribed, true)
  })
})

test("when Linux focus routing is explicitly disabled, the plugin leaves it disabled", async () => {
  await withBridge(
    BASE_PORT + 7,
    async ({ commands, handlers }) => {
      // Arrange
      let subscribed = false
      const context = {
        hasUI: true,
        ui: {
          notify() {},
          onTerminalInput() {
            subscribed = true
            return () => {}
          },
        },
      }
      // Act
      await handlers.get("session_start")({}, context)
      await commands.get("ide").handler("", context)
      process.stdin.emit("data", "\x1b[I")

      // Assert
      assert.equal(subscribed, false)
    },
    {
      pluginSettings: {
        claimIdeContextOnFocus: false,
      },
    }
  )
})

test("when diagnostics toggles with forced focus, capture changes without repairing a lost subscription", async () => {
  await withBridge(
    BASE_PORT + 31,
    async ({ handlers, homeDirectory, pluginsLockFile, stateFile, terminalWrites }) => {
      // Arrange
      const inputHandlers = new Set()
      const context = {
        hasUI: true,
        ui: {
          onTerminalInput(handler) {
            inputHandlers.add(handler)
            return () => inputHandlers.delete(handler)
          },
        },
      }
      await handlers.get("session_start")({}, context)
      inputHandlers.clear()
      const originalState = await fs.readFile(stateFile, "utf8")
      const logsDirectory = path.join(homeDirectory, ".omp", "agent", "send-context-diagnostics")
      let logPath

      // Act
      await fs.writeFile(
        pluginsLockFile,
        JSON.stringify({
          settings: {
            "omp-send-context": { claimIdeContextOnFocus: false, diagnostics: true },
          },
        })
      )
      await waitFor(async () => {
        const files = await fs.readdir(logsDirectory).catch(() => [])
        logPath = files[0] === undefined ? undefined : path.join(logsDirectory, files[0])
        return (
          logPath !== undefined &&
          (await fs.readFile(logPath, "utf8")).includes('"event":"enabled"')
        )
      })
      await fs.writeFile(
        pluginsLockFile,
        JSON.stringify({
          settings: {
            "omp-send-context": { claimIdeContextOnFocus: false, diagnostics: false },
          },
        })
      )
      await waitFor(async () => (await fs.readFile(logPath, "utf8")).includes('"event":"disabled"'))

      // Assert
      assert.equal(inputHandlers.size, 0)
      assert.deepEqual(terminalWrites, ["\x1b[?1004h"])
      assert.equal(await fs.readFile(stateFile, "utf8"), originalState)
    },
    {
      flags: { "claim-ide-context-on-focus": true },
      pluginSettings: { claimIdeContextOnFocus: false },
    }
  )
})

test("when diagnostics is enabled with autofocus opted out, capture starts without terminal controls", async () => {
  await withBridge(
    BASE_PORT + 32,
    async ({ handlers, homeDirectory, pluginsLockFile, terminalWrites }) => {
      // Arrange
      await handlers.get("session_start")({}, { hasUI: true, ui: {} })
      const logsDirectory = path.join(homeDirectory, ".omp", "agent", "send-context-diagnostics")
      let logPath

      // Act
      await fs.writeFile(
        pluginsLockFile,
        JSON.stringify({
          settings: {
            "omp-send-context": { claimIdeContextOnFocus: false, diagnostics: true },
          },
        })
      )
      await waitFor(async () => {
        const files = await fs.readdir(logsDirectory).catch(() => [])
        logPath = files[0] === undefined ? undefined : path.join(logsDirectory, files[0])
        return (
          logPath !== undefined &&
          (await fs.readFile(logPath, "utf8")).includes('"event":"snapshot"')
        )
      })

      // Assert
      const records = (await fs.readFile(logPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
      const snapshot = records.find((record) => record.event === "snapshot")
      assert.equal(snapshot.details.focusSubscriptionRegistered, false)
      assert.equal(snapshot.details.stdinGuardPresent, false)
      assert.deepEqual(terminalWrites, [])
    },
    { pluginSettings: { claimIdeContextOnFocus: false } }
  )
})

test("when plugin settings change in a running Linux session, focus routing follows them", async () => {
  await withBridge(
    BASE_PORT + 13,
    async ({ handlers, pluginsLockFile, terminalWrites }) => {
      // Arrange
      let focusHandler
      let focusUnsubscribed = false
      await handlers.get("session_start")(
        {},
        {
          hasUI: true,
          ui: {
            onTerminalInput(handler) {
              focusHandler = handler
              return () => {
                focusUnsubscribed = true
              }
            },
          },
        }
      )

      assert.equal(focusHandler, undefined)

      // Act
      await fs.writeFile(
        pluginsLockFile,
        JSON.stringify({
          settings: {
            "omp-send-context": {
              claimIdeContextOnFocus: true,
            },
          },
        })
      )
      await waitFor(() => typeof focusHandler === "function")
      assert.deepEqual(terminalWrites, ["\x1b[?1004h"])

      await fs.writeFile(
        pluginsLockFile,
        JSON.stringify({
          settings: {
            "omp-send-context": {
              claimIdeContextOnFocus: false,
            },
          },
        })
      )
      // Assert
      await waitFor(() => focusUnsubscribed)
      assert.deepEqual(terminalWrites, ["\x1b[?1004h", "\x1b[?1004l"])
    },
    {
      pluginSettings: {
        claimIdeContextOnFocus: false,
      },
    }
  )
})

test("when running outside Linux by default, focus routing is disabled", async () => {
  await withBridge(
    BASE_PORT + 12,
    async ({ commands, handlers, terminalWrites }) => {
      // Arrange
      let subscribed = false
      const context = {
        hasUI: true,
        ui: {
          notify() {},
          onTerminalInput() {
            subscribed = true
            return () => {}
          },
        },
      }
      // Act
      await handlers.get("session_start")({}, context)
      await commands.get("ide").handler("", context)
      process.stdin.emit("data", "\x1b[I")

      // Assert
      assert.equal(subscribed, false)
      assert.deepEqual(terminalWrites, [])
    },
    {
      platform: "darwin",
    }
  )
})

test("when terminal input listeners are unavailable, focus routing warns", async () => {
  await withBridge(
    BASE_PORT + 9,
    async ({ handlers }) => {
      // Arrange
      const notifications = []
      // Act
      await handlers.get("session_start")(
        {},
        {
          hasUI: true,
          ui: {
            notify(message, type) {
              notifications.push({ message, type })
            },
          },
        }
      )
      // Assert
      assert.equal(notifications[0]?.type, "warning")
    },
    {
      flags: {
        "claim-ide-context-on-focus": true,
      },
    }
  )
})

test("when the focus flag is enabled, an xterm focus report claims the bridge", async () => {
  await withBridge(
    BASE_PORT + 7,
    async ({ handlers, stateFile, terminalWrites }) => {
      // Arrange
      const ownerPort = BASE_PORT + 8
      const ownerServer = createServer((_request, response) => {
        response.writeHead(200, {
          "Content-Type": "application/json",
        })
        response.end(JSON.stringify({ ok: true, instanceId: "owner-instance" }))
      })
      await new Promise((resolve) => ownerServer.listen(ownerPort, "127.0.0.1", resolve))

      let focusHandler
      let focusUnsubscribed = false
      try {
        await fs.mkdir(path.dirname(stateFile), {
          recursive: true,
        })
        await fs.writeFile(
          stateFile,
          JSON.stringify({
            endpoint: `http://127.0.0.1:${ownerPort}`,
            token: "owner-token",
            instanceId: "owner-instance",
          })
        )
        await handlers.get("session_start")(
          {},
          {
            hasUI: true,
            ui: {
              onTerminalInput(handler) {
                focusHandler = handler
                return () => {
                  focusUnsubscribed = true
                }
              },
            },
          }
        )

        // Act
        const focusResult = focusHandler("\x1b[I")
        await waitFor(
          async () =>
            JSON.parse(await fs.readFile(stateFile, "utf8")).endpoint ===
            `http://127.0.0.1:${BASE_PORT + 7}`
        )

        // Assert
        assert.deepEqual(focusResult, { consume: true })
        await handlers.get("session_shutdown")()
        assert.equal(focusUnsubscribed, true)
        assert.deepEqual(terminalWrites, ["\x1b[?1004h", "\x1b[?1004l"])
      } finally {
        await new Promise((resolve) => ownerServer.close(resolve))
      }
    },
    {
      flags: {
        "claim-ide-context-on-focus": true,
      },
    }
  )
})

async function withOtherConsole(stateFile, run) {
  const runtime = createBridgeRuntime({
    deliverPrompt() {},
    notify() {},
    packageFile: path.resolve("package.json"),
    stateFile,
    defaultPort: 0,
  })
  try {
    await runtime.start()
    await runtime.claim({ force: true })
    await run(runtime)
  } finally {
    await runtime.close()
  }
}

test("when typing in an already-focused console, it selects without treating probes as activity", async () => {
  await withBridge(BASE_PORT + 30, async ({ handlers, stateFile }) => {
    // Arrange
    await withOtherConsole(stateFile, async (otherConsole) => {
      let inputHandler
      let editorText = ""
      const context = {
        hasUI: true,
        ui: {
          onTerminalInput(handler) {
            inputHandler = handler
            return () => {}
          },
          async pasteToEditor(text) {
            editorText += text
          },
        },
      }
      // Act
      await handlers.get("session_start")({}, context)
      inputHandler("\x1b[1;1R\x1b[?1;2c\x1b[?1u\x1b[?1004;1$y\x1b]10;rgb:ffff/ffff/ffff\x1b\\")
      // Assert
      assert.equal(JSON.parse(await fs.readFile(stateFile, "utf8")).endpoint, otherConsole.endpoint)

      assert.deepEqual(inputHandler("draft"), { data: "draft" })
      await waitFor(
        async () =>
          JSON.parse(await fs.readFile(stateFile, "utf8")).endpoint !== otherConsole.endpoint
      )
      const selected = JSON.parse(await fs.readFile(stateFile, "utf8"))
      assert.equal((await postContext(selected, { prompt: "typed-console-context" })).status, 200)
      assert.equal(editorText, "typed-console-context ")
    })
  })
})

test("when an older process resumes after suspend, focus selects it over a restarted console", async (t) => {
  await withBridge(BASE_PORT + 39, async ({ handlers, stateFile }) => {
    // Arrange
    await withOtherConsole(stateFile, async (otherConsole) => {
      let inputHandler
      let editorText = ""
      const context = {
        hasUI: true,
        ui: {
          onTerminalInput(handler) {
            inputHandler = handler
            return () => {}
          },
          async pasteToEditor(text) {
            editorText += text
          },
        },
      }
      await handlers.get("session_start")({}, context)
      await otherConsole.claim({ force: true, claimedAt: Date.now() - 1000 })
      const originalNow = performance.now.bind(performance)
      t.mock.method(performance, "now", () => originalNow() - 28_027_833)

      // Act
      inputHandler("\x1b[I")
      await waitFor(
        async () =>
          JSON.parse(await fs.readFile(stateFile, "utf8")).endpoint !== otherConsole.endpoint
      )
      const selected = JSON.parse(await fs.readFile(stateFile, "utf8"))
      const response = await postContext(selected, { prompt: "resumed-console-context" })

      // Assert
      assert.equal(response.status, 200)
      assert.equal(editorText, "resumed-console-context ")
    })
  })
})

test("when OMP clears the input subscription, a session switch restores it", async () => {
  await withBridge(BASE_PORT + 31, async ({ handlers, stateFile }) => {
    // Arrange
    await withOtherConsole(stateFile, async (otherConsole) => {
      let inputHandler
      let editorText = ""
      const context = {
        hasUI: true,
        ui: {
          onTerminalInput(handler) {
            inputHandler = handler
            return () => {
              inputHandler = undefined
            }
          },
          async pasteToEditor(text) {
            editorText += text
          },
        },
      }
      await handlers.get("session_start")({}, context)
      // Act
      // New-session creation clears listeners before emitting session_switch.
      inputHandler = undefined
      await handlers.get("session_switch")({}, context)
      await otherConsole.claim({ force: true })
      inputHandler("\x1b[I")
      // Assert
      await waitFor(
        async () =>
          JSON.parse(await fs.readFile(stateFile, "utf8")).endpoint !== otherConsole.endpoint
      )
      const selected = JSON.parse(await fs.readFile(stateFile, "utf8"))
      assert.equal((await postContext(selected, { prompt: "new-session-context" })).status, 200)
      assert.equal(editorText, "new-session-context ")
    })
  })
})

test("when a session switch is cancelled, keyboard activity restores routing without claiming on rearm", async () => {
  await withBridge(BASE_PORT + 34, async ({ commands, handlers, stateFile }) => {
    // Arrange
    await withOtherConsole(stateFile, async (otherConsole) => {
      let inputHandler
      let editorText = ""
      const context = {
        hasUI: true,
        ui: {
          notify() {},
          onTerminalInput(handler) {
            inputHandler = handler
            return () => {
              inputHandler = undefined
            }
          },
          async pasteToEditor(text) {
            editorText += text
          },
        },
      }
      await handlers.get("session_start")({}, context)
      // Act
      // OMP clears listeners before its cancellable session_before_switch event.
      inputHandler = undefined
      process.stdin.emit("data", "draft")
      await commands.get("ide").handler("status", context)
      assert.equal(JSON.parse(await fs.readFile(stateFile, "utf8")).endpoint, otherConsole.endpoint)

      inputHandler("draft")
      // Assert
      await waitFor(
        async () =>
          JSON.parse(await fs.readFile(stateFile, "utf8")).endpoint !== otherConsole.endpoint
      )
      const selected = JSON.parse(await fs.readFile(stateFile, "utf8"))
      assert.equal(
        (await postContext(selected, { prompt: "cancelled-session-context" })).status,
        200
      )
      assert.equal(editorText, "cancelled-session-context ")
    })
  })
})

test("when earlier cancellation skips session hooks, stdin activity restores autofocus", async (t) => {
  await withBridge(BASE_PORT + 36, async ({ commands, handlers, stateFile }) => {
    // Arrange
    await withOtherConsole(stateFile, async (otherConsole) => {
      let inputHandler
      let editorText = ""

      const dispatchInput = (data) => inputHandler?.(data)
      // Register the dispatcher without putting the test runner's stdin into flowing mode.
      process.stdin.prependListener("data", dispatchInput)
      t.after(() => process.stdin.removeListener("data", dispatchInput))

      const context = {
        hasUI: true,
        ui: {
          notify() {},
          onTerminalInput(handler) {
            inputHandler = handler
            return () => {
              inputHandler = undefined
            }
          },
          async pasteToEditor(text) {
            editorText += text
          },
        },
      }

      await handlers.get("session_start")({}, context)
      process.stdin.emit("data", "\x1b[I")
      await otherConsole.claim({ force: true })

      // Act
      // OMP clears input; an earlier cancellation skips both of our switch hooks.
      inputHandler = undefined
      // Node dispatches stdin before OMP delivers the report to its input listeners.
      process.stdin.emit("data", "\x1b[I")
      await waitFor(
        async () =>
          JSON.parse(await fs.readFile(stateFile, "utf8")).endpoint !== otherConsole.endpoint
      )

      // Assert
      const selected = JSON.parse(await fs.readFile(stateFile, "utf8"))
      assert.equal((await postContext(selected, { prompt: "skipped-hook-context" })).status, 200)
      assert.equal(editorText, "skipped-hook-context ")

      await otherConsole.claim({ force: true })
      process.stdin.emit("data", "\x1b[O")
      await commands.get("ide").handler("status", context)
      assert.equal(JSON.parse(await fs.readFile(stateFile, "utf8")).endpoint, otherConsole.endpoint)
    })
  })
})

test("when enabled autofocus loses its input subscription, /ide repairs it without later focus-out claims", async () => {
  await withBridge(BASE_PORT + 35, async ({ commands, handlers, stateFile }) => {
    // Arrange
    await withOtherConsole(stateFile, async (otherConsole) => {
      let inputHandler
      let editorText = ""
      const context = {
        hasUI: true,
        ui: {
          notify() {},
          onTerminalInput(handler) {
            inputHandler = handler
            return () => {
              inputHandler = undefined
            }
          },
          async pasteToEditor(text) {
            editorText += text
          },
        },
      }
      await handlers.get("session_start")({}, context)
      // Act
      inputHandler("\x1b[I")
      inputHandler = undefined
      await commands.get("ide").handler("", context)
      const manuallySelected = JSON.parse(await fs.readFile(stateFile, "utf8"))
      assert.equal((await postContext(manuallySelected, { prompt: "manual-context" })).status, 200)

      await otherConsole.claim({ force: true })
      inputHandler("\x1b[O")
      await commands.get("ide").handler("status", context)
      assert.equal(JSON.parse(await fs.readFile(stateFile, "utf8")).endpoint, otherConsole.endpoint)

      inputHandler("\x1b[I")
      // Assert
      await waitFor(
        async () =>
          JSON.parse(await fs.readFile(stateFile, "utf8")).endpoint !== otherConsole.endpoint
      )
      const automaticallySelected = JSON.parse(await fs.readFile(stateFile, "utf8"))
      assert.equal(automaticallySelected.instanceId, manuallySelected.instanceId)
      assert.equal(
        (await postContext(automaticallySelected, { prompt: "automatic-context" })).status,
        200
      )
      assert.equal(editorText, "manual-context automatic-context ")
    })
  })
})

test("when the plugin reloads, it retains activity order without stealing newer console activity", async () => {
  await withBridge(BASE_PORT + 32, async ({ commands, handlers, stateFile, reloadExtension }) => {
    // Arrange
    await withOtherConsole(stateFile, async (otherConsole) => {
      let editorText = ""
      let inputHandler
      const context = {
        hasUI: true,
        ui: {
          notify() {},
          onTerminalInput(handler) {
            inputHandler = handler
            return () => {
              inputHandler = undefined
            }
          },
          async pasteToEditor(text) {
            editorText += text
          },
        },
      }
      await handlers.get("session_start")({}, context)
      // Act
      await commands.get("ide").handler("", context)
      const original = JSON.parse(await fs.readFile(stateFile, "utf8"))

      await reloadExtension()
      await handlers.get("session_start")({}, context)
      const reloaded = JSON.parse(await fs.readFile(stateFile, "utf8"))
      assert.notEqual(reloaded.instanceId, original.instanceId)
      assert.equal(reloaded.claimedAt, original.claimedAt)
      assert.equal((await postContext(reloaded, { prompt: "after-reload" })).status, 200)
      assert.equal(editorText, "after-reload ")

      await reloadExtension(() => {
        process.stdin.emit("data", "\x1b[I")
        return otherConsole.claim({ force: true })
      })
      await handlers.get("session_start")({}, context)
      assert.equal(JSON.parse(await fs.readFile(stateFile, "utf8")).endpoint, otherConsole.endpoint)

      process.stdin.emit("data", "\x1b[I")
      inputHandler("\x1b[I")
      await waitFor(
        async () =>
          JSON.parse(await fs.readFile(stateFile, "utf8")).endpoint !== otherConsole.endpoint
      )

      // Assert
      const selected = JSON.parse(await fs.readFile(stateFile, "utf8"))
      assert.equal((await postContext(selected, { prompt: "refocused-after-reload" })).status, 200)
      assert.equal(editorText, "after-reload refocused-after-reload ")
    })
  })
})

test("when a background restart receives capability and mouse reports, the active console keeps delivery", async () => {
  await withBridge(BASE_PORT + 37, async ({ commands, handlers, stateFile }) => {
    // Arrange
    await withOtherConsole(stateFile, async (otherConsole) => {
      let inputHandler
      const context = {
        hasUI: true,
        ui: {
          notify() {},
          onTerminalInput(handler) {
            inputHandler = handler
            return () => {}
          },
        },
      }
      await handlers.get("session_start")({}, context)

      // Act
      inputHandler("\x1b[?2;0;256S")
      inputHandler("\x1b[<35;12;5M")
      inputHandler("\x1b[<0;12;5m")
      await commands.get("ide").handler("status", context)

      // Assert
      const selected = JSON.parse(await fs.readFile(stateFile, "utf8"))
      assert.equal(selected.endpoint, otherConsole.endpoint)
    })
  })
})

test("when a background session finishes switching, newer terminal activity keeps ownership", async () => {
  await withBridge(BASE_PORT + 38, async ({ handlers, stateFile }) => {
    // Arrange
    await withOtherConsole(stateFile, async (otherConsole) => {
      const context = {
        hasUI: true,
        ui: {
          onTerminalInput() {
            return () => {}
          },
        },
      }
      await handlers.get("session_start")({}, context)

      // Act
      await otherConsole.claim({ force: true })
      await handlers.get("session_switch")({}, context)

      // Assert
      const selected = JSON.parse(await fs.readFile(stateFile, "utf8"))
      assert.equal(selected.endpoint, otherConsole.endpoint)
    })
  })
})

test("when a restarted console sends its first focus-out after another focus-in, it does not steal delivery", async () => {
  await withBridge(BASE_PORT + 33, async ({ commands, handlers, stateFile }) => {
    // Arrange
    await withOtherConsole(stateFile, async (otherConsole) => {
      let inputHandler
      const context = {
        hasUI: true,
        ui: {
          notify() {},
          onTerminalInput(handler) {
            inputHandler = handler
            return () => {}
          },
        },
      }
      await handlers.get("session_start")({}, context)
      await otherConsole.claim({ force: true })

      // Act
      inputHandler("\x1b[O")
      await commands.get("ide").handler("status", context)

      // Assert
      const selected = JSON.parse(await fs.readFile(stateFile, "utf8"))
      assert.equal(selected.endpoint, otherConsole.endpoint)
    })
  })
})
