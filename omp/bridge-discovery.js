import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { performance } from "node:perf_hooks"

const HOST = "127.0.0.1"
const HEALTH_TIMEOUT_MILLISECONDS = 500
const DISCOVERY_TIMEOUT_MILLISECONDS = 1500

export async function resolveBridgeState(stateFile, options = {}) {
  const deadline = performance.now() + DISCOVERY_TIMEOUT_MILLISECONDS
  const configuredEndpoint =
    options.endpoint === undefined ? undefined : normalizeEndpoint(options.endpoint)
  if (options.endpoint !== undefined && configuredEndpoint === undefined) {
    return undefined
  }

  const remainingReadTime = deadline - performance.now()
  if (remainingReadTime <= 0) {
    return undefined
  }
  let readTimeout
  const readResult = await Promise.race([
    Promise.all([readState(stateFile), readRegistry(`${stateFile}.d`)]).then(
      ([pointerState, registryStates]) => ({ pointerState, registryStates })
    ),
    new Promise((resolve) => {
      readTimeout = setTimeout(() => resolve(undefined), remainingReadTime)
    }),
  ])
  clearTimeout(readTimeout)
  if (readResult === undefined) {
    return undefined
  }

  const { pointerState, registryStates } = readResult
  const statesByInstanceId = new Map(registryStates.map((state) => [state.instanceId, state]))
  const candidates = registryStates.map((state) => ({
    state,
    activity: activityOf(state),
    isPointer: pointerState?.instanceId === state.instanceId,
  }))

  if (pointerState !== undefined && !statesByInstanceId.has(pointerState.instanceId)) {
    candidates.push({
      state: pointerState,
      activity: legacyActivityOf(pointerState),
      isPointer: true,
    })
  }

  const eligible = candidates
    .map((candidate) => ({
      ...candidate,
      endpoint: normalizeEndpoint(candidate.state.endpoint),
    }))
    .filter(
      (candidate) =>
        candidate.endpoint !== undefined &&
        (configuredEndpoint === undefined || candidate.endpoint === configuredEndpoint)
    )
    .sort((left, right) => {
      if (left.activity !== right.activity) {
        return right.activity - left.activity
      }
      return Number(right.isPointer) - Number(left.isPointer)
    })

  for (const candidate of eligible) {
    if (performance.now() >= deadline) {
      return undefined
    }
    if (isProcessDefinitelyGone(candidate.state.pid)) {
      continue
    }

    const remainingTime = deadline - performance.now()
    if (remainingTime <= 0) {
      return undefined
    }
    const probeResult = await probeEndpoint(
      candidate.endpoint,
      candidate.state.instanceId,
      Math.min(HEALTH_TIMEOUT_MILLISECONDS, remainingTime)
    )
    if (probeResult === "healthy") {
      return { ...candidate.state, endpoint: candidate.endpoint }
    }
    if (probeResult === "ambiguous") {
      return undefined
    }
  }
  return undefined
}

async function readRegistry(directory) {
  let filenames
  try {
    filenames = await readdir(directory)
  } catch {
    return []
  }

  const states = await Promise.all(
    filenames
      .filter((filename) => filename.endsWith(".json"))
      .map(async (filename) => {
        const state = await readState(join(directory, filename))
        const instanceId = filename.slice(0, -".json".length)
        return state?.instanceId === instanceId ? state : undefined
      })
  )
  return states.filter((state) => state !== undefined)
}

async function readState(path) {
  try {
    const state = JSON.parse(await readFile(path, "utf8"))
    if (
      typeof state.endpoint !== "string" ||
      typeof state.token !== "string" ||
      state.token.length === 0 ||
      /[\r\n]/.test(state.token) ||
      typeof state.instanceId !== "string" ||
      state.instanceId.length === 0
    ) {
      return undefined
    }
    return state
  } catch {
    return undefined
  }
}

function normalizeEndpoint(endpoint) {
  if (typeof endpoint !== "string") {
    return undefined
  }
  try {
    const parsed = new URL(endpoint)
    const port = Number(parsed.port)
    if (
      parsed.protocol !== "http:" ||
      parsed.hostname !== HOST ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      (parsed.pathname !== "/" && parsed.pathname !== "") ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    ) {
      return undefined
    }
    return `http://${HOST}:${port}`
  } catch {
    return undefined
  }
}

function activityOf(state) {
  return Number.isFinite(state.claimedAt) ? state.claimedAt : 0
}

function legacyActivityOf(state) {
  if (Number.isFinite(state.claimedAt)) {
    return state.claimedAt
  }
  const updatedAt = Date.parse(state.updatedAt)
  return Number.isFinite(updatedAt) ? updatedAt : 0
}

function isProcessDefinitelyGone(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false
  }
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return error?.code === "ESRCH"
  }
}

async function probeEndpoint(endpoint, expectedInstanceId, timeoutMilliseconds) {
  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMilliseconds)
  try {
    const response = await fetch(`${endpoint}/health`, {
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    })
    if (response.status === 404) {
      return "gone"
    }
    if (!response.ok) {
      return "ambiguous"
    }
    let health
    try {
      health = await response.json()
    } catch {
      return "ambiguous"
    }
    return health?.instanceId === expectedInstanceId ? "healthy" : "gone"
  } catch (error) {
    if (timedOut) {
      return "ambiguous"
    }
    return hasErrorCode(error, "ECONNREFUSED") ? "gone" : "ambiguous"
  } finally {
    clearTimeout(timeout)
  }
}

function hasErrorCode(error, expectedCode) {
  let currentError = error
  for (let depth = 0; depth < 5 && currentError !== undefined; depth += 1) {
    if (currentError?.code === expectedCode) {
      return true
    }
    currentError = currentError?.cause
  }
  return false
}
