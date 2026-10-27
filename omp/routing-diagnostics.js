import { randomBytes } from "node:crypto"
import { appendFile, chmod, mkdir, open, rename, rm, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const DEFAULT_MAX_FILE_BYTES = 1024 * 1024
const MAX_REGISTRATION_BYTES = 2 * 1024 * 1024
const DEFAULT_SAMPLE_INTERVAL = 5000
const INPUT_COALESCE_INTERVAL = 1000
const MAX_SNAPSHOT_STRING_LENGTH = 128
const MAX_ERROR_CODE_LENGTH = 64

const SUPPORTED_EVENTS = new Set([
  "enabled",
  "disabled",
  "snapshot",
  "closed",
  "session_start",
  "session_switch",
  "session_shutdown",
  "claim_requested",
  "claim_completed",
  "bridge_started",
  "bridge_start_failed",
  "bridge_closed",
  "delivery",
  "delivery_failed",
  "settings_changed",
  "input_guard",
])

const SUPPORTED_OPERATIONS = new Set([
  ...SUPPORTED_EVENTS,
  "focus-in",
  "focus-out",
  "keyboard",
  "terminal-report",
])

const INPUT_KINDS = new Set(["focus-in", "focus-out", "keyboard", "terminal-report"])
const RATE_LIMITED_INPUT_KINDS = new Set(["keyboard", "terminal-report"])
const SNAPSHOT_FIELDS = [
  "version",
  "instanceId",
  "endpoint",
  "claimedAt",
  "hasUI",
  "focusSubscriptionRegistered",
  "stdinGuardPresent",
  "sessionId",
  "agentKind",
  "mode",
]

export function createRoutingDiagnostics({
  getSnapshot = () => undefined,
  onError = () => {},
  directory = join(homedir(), ".omp", "agent", "send-context-diagnostics"),
  maxBytes = DEFAULT_MAX_FILE_BYTES,
  sampleInterval = DEFAULT_SAMPLE_INTERVAL,
} = {}) {
  const fileLimit = boundedPositiveInteger(
    maxBytes,
    DEFAULT_MAX_FILE_BYTES,
    MAX_REGISTRATION_BYTES / 2
  )
  const interval = boundedPositiveInteger(sampleInterval, DEFAULT_SAMPLE_INTERVAL)

  let requestedEnabled = false
  let activeEnabled = false
  let closed = false
  let timer
  let storageDirectoryReady = false
  let activeFileReady = false
  let activeFilePath
  let rotatedFilePath
  let lastUsablePath
  let activeFileBytes = 0
  let lastSnapshotSignature
  let ioQueue = Promise.resolve()
  const lastInputTimes = new Map()

  function reportError(error) {
    try {
      Promise.resolve(onError(error)).catch(() => {})
    } catch {}
  }

  function enqueue(operation) {
    ioQueue = ioQueue.then(operation).catch(reportError)
    return ioQueue
  }

  function stopSampling() {
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }

  async function ensureStorageDirectory() {
    if (storageDirectoryReady) {
      return
    }

    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700)
    storageDirectoryReady = true
  }

  async function createActiveFile() {
    if (activeFilePath === undefined) {
      const registrationId = randomBytes(12).toString("hex")
      const filename = `${process.pid}-${registrationId}.jsonl`
      activeFilePath = join(directory, filename)
      rotatedFilePath = `${activeFilePath}.1`
    }

    const handle = await open(activeFilePath, "wx", 0o600)
    await handle.close()
    activeFileReady = true
    activeFileBytes = 0
    lastUsablePath = activeFilePath
  }

  async function ensureActiveFile() {
    await ensureStorageDirectory()
    if (activeFileReady) {
      return
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await createActiveFile()
        return
      } catch (error) {
        if (error?.code !== "EEXIST") {
          throw error
        }

        // A collision is possible only if a generated name already exists.
        if (activeFilePath !== undefined) {
          activeFilePath = undefined
          rotatedFilePath = undefined
        }
      }
    }

    const error = new Error("Could not allocate a private diagnostics file")
    error.code = "ERR_DIAGNOSTICS_FILENAME_COLLISION"
    throw error
  }

  async function readActiveFileSize() {
    if (activeFileBytes !== undefined) {
      return activeFileBytes
    }

    const metadata = await stat(activeFilePath)
    activeFileBytes = metadata.size
    return activeFileBytes
  }

  async function rotateActiveFile() {
    await rm(rotatedFilePath, { force: true })
    await rename(activeFilePath, rotatedFilePath)
    activeFileReady = false
    activeFileBytes = 0
    lastUsablePath = rotatedFilePath
    await createActiveFile()
  }

  async function appendEntry(event, details, force = false) {
    if (!force && !activeEnabled) {
      return
    }

    await ensureActiveFile()

    const entry = { at: new Date().toISOString(), event }
    if (details !== undefined) {
      entry.details = details
    }
    const line = `${JSON.stringify(entry)}\n`
    const lineBytes = Buffer.byteLength(line, "utf8")
    if (lineBytes > fileLimit) {
      const error = new Error("Diagnostics record exceeds the configured file limit")
      error.code = "ERR_DIAGNOSTICS_ENTRY_TOO_LARGE"
      throw error
    }

    const currentBytes = await readActiveFileSize()
    if (currentBytes > 0 && currentBytes + lineBytes > fileLimit) {
      await rotateActiveFile()
    }

    try {
      await appendFile(activeFilePath, line, { encoding: "utf8", mode: 0o600 })
      activeFileBytes += lineBytes
      lastUsablePath = activeFilePath
    } catch (error) {
      activeFileBytes = undefined
      throw error
    }
  }

  function sanitizeSnapshot(snapshot) {
    if (snapshot === null || typeof snapshot !== "object") {
      return undefined
    }

    const sanitized = {}
    for (const field of SNAPSHOT_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(snapshot, field)) {
        continue
      }

      const value = snapshot[field]
      if (field === "endpoint") {
        const endpoint = normalizeLoopbackEndpoint(value)
        if (endpoint !== undefined) {
          sanitized.endpoint = endpoint
        }
      } else if (field === "claimedAt") {
        if (typeof value === "number" && Number.isFinite(value)) {
          sanitized.claimedAt = value
        }
      } else if (
        field === "hasUI" ||
        field === "focusSubscriptionRegistered" ||
        field === "stdinGuardPresent"
      ) {
        if (typeof value === "boolean") {
          sanitized[field] = value
        }
      } else if (field === "version" && typeof value === "number" && Number.isFinite(value)) {
        sanitized.version = value
      } else if (typeof value === "string") {
        sanitized[field] = value.slice(0, MAX_SNAPSHOT_STRING_LENGTH)
      }
    }

    return sanitized
  }

  function sanitizeEventDetails(details) {
    if (details === null || typeof details !== "object") {
      return undefined
    }

    const sanitized = {}
    if (Object.prototype.hasOwnProperty.call(details, "operation")) {
      const operation = details.operation
      if (typeof operation === "string" && SUPPORTED_OPERATIONS.has(operation)) {
        sanitized.operation = operation
      }
    }

    if (Object.prototype.hasOwnProperty.call(details, "errorCode")) {
      const errorCode = details.errorCode
      if (typeof errorCode === "string" && isSafeErrorCode(errorCode)) {
        sanitized.errorCode = errorCode
      }
    }

    if (Object.keys(sanitized).length > 0) {
      return sanitized
    }

    return undefined
  }

  function sanitizeRecordDetails(event, details) {
    try {
      if (event === "snapshot") {
        return sanitizeSnapshot(details)
      }
      return sanitizeEventDetails(details)
    } catch (error) {
      reportError(error)
      return undefined
    }
  }

  async function sampleSnapshot() {
    if (!requestedEnabled || !activeEnabled || closed) {
      return
    }

    const snapshot = sanitizeSnapshot(await getSnapshot())
    if (snapshot === undefined) {
      return
    }

    const signature = JSON.stringify(snapshot)
    if (signature === lastSnapshotSignature) {
      return
    }

    await appendEntry("snapshot", snapshot)
    lastSnapshotSignature = signature
  }

  function startSampling() {
    stopSampling()
    timer = setInterval(() => {
      void enqueue(sampleSnapshot)
    }, interval)
    timer.unref?.()
  }

  async function enableDiagnostics() {
    if (closed || !requestedEnabled) {
      return
    }

    activeEnabled = true
    await appendEntry("enabled", undefined)
    await sampleSnapshot()
    if (requestedEnabled && !closed) {
      startSampling()
    }
  }

  async function disableDiagnostics() {
    stopSampling()
    try {
      if (activeEnabled) {
        await appendEntry("disabled", undefined, true)
      }
    } finally {
      activeEnabled = false
      lastSnapshotSignature = undefined
    }
  }

  return {
    setEnabled(enabled) {
      if (closed || requestedEnabled === enabled) {
        return ioQueue
      }

      requestedEnabled = enabled
      if (!enabled) {
        stopSampling()
        return enqueue(disableDiagnostics)
      }

      return enqueue(enableDiagnostics)
    },

    record(event, details) {
      if (closed || !requestedEnabled || !SUPPORTED_EVENTS.has(event)) {
        return
      }

      const sanitizedDetails = sanitizeRecordDetails(event, details)
      void enqueue(async () => {
        await appendEntry(event, sanitizedDetails)
      })
    },

    observeInput(kind) {
      if (closed || !requestedEnabled || !INPUT_KINDS.has(kind)) {
        return
      }

      const now = Date.now()
      if (RATE_LIMITED_INPUT_KINDS.has(kind)) {
        const previousTime = lastInputTimes.get(kind)
        if (previousTime !== undefined && now - previousTime < INPUT_COALESCE_INTERVAL) {
          return
        }
        lastInputTimes.set(kind, now)
      }

      void enqueue(async () => {
        await appendEntry("input_guard", { operation: kind })
      })
    },

    async close() {
      if (closed) {
        return ioQueue
      }

      closed = true
      requestedEnabled = false
      stopSampling()
      return enqueue(async () => {
        try {
          if (activeEnabled) {
            await appendEntry("closed", undefined, true)
          }
        } finally {
          activeEnabled = false
          lastSnapshotSignature = undefined
        }
      })
    },

    get enabled() {
      return requestedEnabled
    },

    get path() {
      return lastUsablePath
    },
  }
}

function boundedPositiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    return fallback
  }
  return Math.min(value, maximum)
}

function isSafeErrorCode(value) {
  return value.length <= MAX_ERROR_CODE_LENGTH && /^[A-Z][A-Z0-9_]{0,63}$/.test(value)
}

function normalizeLoopbackEndpoint(value) {
  if (typeof value !== "string") {
    return undefined
  }

  try {
    const endpoint = new URL(value)
    const portMatch = /^http:\/\/127\.0\.0\.1:(\d+)(?:[/?#]|$)/.exec(value)
    if (
      endpoint.protocol !== "http:" ||
      endpoint.hostname !== "127.0.0.1" ||
      portMatch === null ||
      endpoint.username ||
      endpoint.password
    ) {
      return undefined
    }

    const port = Number(portMatch[1])
    if (port === 0) {
      return undefined
    }

    return `http://127.0.0.1:${port}`
  } catch {
    return undefined
  }
}

export default createRoutingDiagnostics
