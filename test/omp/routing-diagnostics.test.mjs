import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { createRoutingDiagnostics } from "#root/omp/routing-diagnostics.js"

async function createFixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-routing-diagnostics-"))
  return {
    directory,
    logsDirectory: path.join(directory, "logs"),
    async cleanup() {
      await fs.rm(directory, { recursive: true, force: true })
    },
  }
}

function parseLog(contents) {
  return contents
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

test("when diagnostics are disabled, capture starts only on opt-in and stops on opt-out", async () => {
  // Arrange
  const fixture = await createFixture()
  const diagnostics = createRoutingDiagnostics({
    directory: fixture.logsDirectory,
    sampleInterval: 60_000,
  })

  try {
    assert.equal(diagnostics.enabled, false)
    assert.equal(diagnostics.path, undefined)

    // Act
    diagnostics.record("delivery", { operation: "delivery" })
    await diagnostics.setEnabled(false)

    // Assert
    await assert.rejects(fs.readdir(fixture.logsDirectory), { code: "ENOENT" })

    // Act
    await diagnostics.setEnabled(true)
    diagnostics.record("delivery", { operation: "delivery" })
    await diagnostics.setEnabled(false)
    const logPath = diagnostics.path
    diagnostics.record("delivery", { operation: "delivery" })

    // Assert
    assert.ok(logPath)
    const records = parseLog(await fs.readFile(logPath, "utf8"))
    assert.deepEqual(
      records.map((record) => record.event),
      ["enabled", "delivery", "disabled"]
    )
  } finally {
    await diagnostics.close()
    await fixture.cleanup()
  }
})

test("when diagnostics capture allowed details, sensitive fields and input text are never persisted", async () => {
  // Arrange
  const fixture = await createFixture()
  const secretPrompt = "private-prompt-canary"
  const secretToken = "private-token-canary"
  const snapshot = {
    version: "2.8.0",
    instanceId: "safe-instance-id",
    endpoint: "http://127.0.0.1:80/private?token=endpoint-secret-canary",
    claimedAt: 1234,
    hasUI: true,
    focusSubscriptionRegistered: false,
    stdinGuardPresent: true,
    sessionId: "safe-session-id",
    agentKind: "omp",
    mode: "interactive",
    prompt: secretPrompt,
    token: secretToken,
    cwd: "/private/path-canary",
    windowTitle: "private-window-canary",
  }
  const diagnostics = createRoutingDiagnostics({
    directory: fixture.logsDirectory,
    getSnapshot: () => snapshot,
    sampleInterval: 60_000,
  })

  try {
    // Act
    await diagnostics.setEnabled(true)
    diagnostics.record("delivery", {
      operation: "delivery",
      errorCode: "EACCES",
      prompt: secretPrompt,
      token: secretToken,
      cwd: "/private/path-canary",
      windowTitle: "private-window-canary",
    })
    diagnostics.observeInput("keyboard", secretPrompt)
    diagnostics.observeInput("keyboard", secretPrompt)
    diagnostics.observeInput("terminal-report", secretToken)
    diagnostics.observeInput("terminal-report", secretToken)
    diagnostics.observeInput("focus-in", secretToken)
    diagnostics.observeInput("focus-in", secretToken)
    await diagnostics.setEnabled(false)

    // Assert
    const contents = await fs.readFile(diagnostics.path, "utf8")
    const records = parseLog(contents)
    const snapshotRecord = records.find((record) => record.event === "snapshot")
    assert.deepEqual(snapshotRecord.details, {
      version: "2.8.0",
      instanceId: "safe-instance-id",
      endpoint: "http://127.0.0.1:80",
      claimedAt: 1234,
      hasUI: true,
      focusSubscriptionRegistered: false,
      stdinGuardPresent: true,
      sessionId: "safe-session-id",
      agentKind: "omp",
      mode: "interactive",
    })
    const deliveryRecord = records.find((record) => record.event === "delivery")
    assert.deepEqual(deliveryRecord.details, {
      operation: "delivery",
      errorCode: "EACCES",
    })
    const inputOperations = records
      .filter((record) => record.event === "input_guard")
      .map((record) => record.details.operation)
    assert.deepEqual(inputOperations, ["keyboard", "terminal-report", "focus-in", "focus-in"])
    assert.ok(contents.includes("EACCES"))
    assert.ok(contents.includes('"operation":"keyboard"'))
    for (const secret of [
      secretPrompt,
      secretToken,
      "endpoint-secret-canary",
      "/private/path-canary",
      "private-window-canary",
    ]) {
      assert.equal(contents.includes(secret), false)
    }

    const directoryMode = (await fs.stat(fixture.logsDirectory)).mode & 0o777
    const fileMode = (await fs.stat(diagnostics.path)).mode & 0o777
    assert.equal(directoryMode, 0o700)
    assert.equal(fileMode, 0o600)
  } finally {
    await diagnostics.close()
    await fixture.cleanup()
  }
})

test("when passive snapshots change, unchanged state is sampled only once", async () => {
  // Arrange
  const fixture = await createFixture()
  let sessionId = "first-session"
  const diagnostics = createRoutingDiagnostics({
    directory: fixture.logsDirectory,
    getSnapshot: () => ({ sessionId }),
    sampleInterval: 10,
  })

  try {
    // Act
    await diagnostics.setEnabled(true)
    await delay(60)
    sessionId = "second-session"
    await delay(60)
    await diagnostics.setEnabled(false)

    // Assert
    const records = parseLog(await fs.readFile(diagnostics.path, "utf8"))
    const snapshots = records.filter((record) => record.event === "snapshot")
    assert.deepEqual(
      snapshots.map((record) => record.details.sessionId),
      ["first-session", "second-session"]
    )
  } finally {
    await diagnostics.close()
    await fixture.cleanup()
  }
})

test("when diagnostics toggle rapidly before close, shutdown prevents later capture", async () => {
  // Arrange
  const fixture = await createFixture()
  let sessionId = "active-session"
  let snapshotReads = 0
  const diagnostics = createRoutingDiagnostics({
    directory: fixture.logsDirectory,
    getSnapshot() {
      snapshotReads += 1
      return { sessionId }
    },
    sampleInterval: 10,
  })

  try {
    // Act
    await Promise.all([
      diagnostics.setEnabled(true),
      diagnostics.setEnabled(false),
      diagnostics.setEnabled(true),
    ])
    diagnostics.record("delivery", { operation: "delivery" })
    await diagnostics.close()
    const readsAtClose = snapshotReads
    const logPath = diagnostics.path
    const contentsAtClose = await fs.readFile(logPath, "utf8")

    await diagnostics.setEnabled(true)
    diagnostics.record("delivery", { operation: "delivery" })
    sessionId = "after-close-session"
    await delay(50)

    // Assert
    assert.equal(diagnostics.enabled, false)
    assert.equal(snapshotReads, readsAtClose)
    assert.equal(await fs.readFile(logPath, "utf8"), contentsAtClose)

    const records = parseLog(contentsAtClose)
    const enabledRecords = records.filter((record) => record.event === "enabled")
    const deliveryRecords = records.filter((record) => record.event === "delivery")
    assert.equal(enabledRecords.length, 2)
    assert.equal(deliveryRecords.length, 1)
    assert.ok(records.some((record) => record.event === "disabled"))
    assert.equal(records[records.length - 1].event, "closed")
    assert.equal(contentsAtClose.includes("after-close-session"), false)
  } finally {
    await diagnostics.close()
    await fixture.cleanup()
  }
})

test("when a log reaches its size limit, rotation retains only bounded latest evidence", async () => {
  // Arrange
  const fixture = await createFixture()
  const diagnostics = createRoutingDiagnostics({
    directory: fixture.logsDirectory,
    getSnapshot: () => undefined,
    maxBytes: 500,
    sampleInterval: 60_000,
  })
  const latestSession = "latest-session-" + "x".repeat(80)

  try {
    // Act
    await diagnostics.setEnabled(true)
    for (let index = 0; index < 12; index += 1) {
      diagnostics.record("snapshot", { sessionId: `session-${index}-` + "y".repeat(80) })
    }
    diagnostics.record("snapshot", { sessionId: latestSession })
    await diagnostics.setEnabled(false)

    // Assert
    const activePath = diagnostics.path
    const rotatedPath = `${activePath}.1`
    const activeContents = await fs.readFile(activePath, "utf8")
    const activeSize = (await fs.stat(activePath)).size
    const rotatedSize = (await fs.stat(rotatedPath)).size
    assert.ok(activeContents.includes(latestSession))
    assert.ok(activeSize <= 500)
    assert.ok(rotatedSize <= 500)
    assert.ok(activeSize + rotatedSize <= 1000)
    assert.equal((await fs.readdir(fixture.logsDirectory)).length, 2)
  } finally {
    await diagnostics.close()
    await fixture.cleanup()
  }
})

test("when diagnostics instances share a directory, each keeps a separate log", async () => {
  // Arrange
  const fixture = await createFixture()
  const first = createRoutingDiagnostics({
    directory: fixture.logsDirectory,
    sampleInterval: 60_000,
  })
  const second = createRoutingDiagnostics({
    directory: fixture.logsDirectory,
    sampleInterval: 60_000,
  })

  try {
    // Act
    await Promise.all([first.setEnabled(true), second.setEnabled(true)])
    first.record("snapshot", { sessionId: "first-instance" })
    second.record("snapshot", { sessionId: "second-instance" })
    await Promise.all([first.setEnabled(false), second.setEnabled(false)])

    // Assert
    assert.notEqual(first.path, second.path)
    const firstContents = await fs.readFile(first.path, "utf8")
    const secondContents = await fs.readFile(second.path, "utf8")
    assert.ok(firstContents.includes("first-instance"))
    assert.equal(firstContents.includes("second-instance"), false)
    assert.ok(secondContents.includes("second-instance"))
    assert.equal(secondContents.includes("first-instance"), false)
  } finally {
    await Promise.all([first.close(), second.close()])
    await fixture.cleanup()
  }
})

test("when diagnostic storage fails, logging and error callbacks do not throw into callers", async () => {
  // Arrange
  const fixture = await createFixture()
  const blockedPath = path.join(fixture.directory, "not-a-directory")
  await fs.writeFile(blockedPath, "blocking file")
  const reportedCodes = []
  const diagnostics = createRoutingDiagnostics({
    directory: path.join(blockedPath, "logs"),
    onError(error) {
      reportedCodes.push(error?.code)
      throw new Error("error callback failure")
    },
    sampleInterval: 60_000,
  })

  try {
    // Act
    await assert.doesNotReject(diagnostics.setEnabled(true))
    assert.doesNotThrow(() => diagnostics.record("delivery", { operation: "delivery" }))
    await assert.doesNotReject(diagnostics.setEnabled(false))
    await assert.doesNotReject(diagnostics.close())

    // Assert
    assert.ok(reportedCodes.includes("ENOTDIR"))
  } finally {
    await diagnostics.close()
    await fixture.cleanup()
  }
})
