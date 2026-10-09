import { randomBytes } from "node:crypto"
import { createServer } from "node:http"
import { chmod, mkdir, readFile, rename, rm, writeFile, link } from "node:fs/promises"
import { homedir } from "node:os"
import { performance } from "node:perf_hooks"
import { dirname, join } from "node:path"

import { resolveBridgeState } from "./bridge-discovery.js"

const HOST = "127.0.0.1"
const MAX_PORT_ATTEMPTS = 20
const MAX_BODY_BYTES = 2 * 1024 * 1024

export function createBridgeRuntime({
  deliverPrompt,
  notify,
  packageFile,
  stateFile = join(homedir(), ".omp", "agent", "editor-context-bridge.json"),
  defaultPort = Number.parseInt(process.env.OMP_CONTEXT_BRIDGE_PORT ?? "47687", 10),
}) {
  let instanceId
  let packageVersion
  let server
  let port
  let token
  let endpoint
  let claimedAt = 0
  let lifecycle = Promise.resolve()

  return {
    start(options = {}) {
      const restoredClaimedAt = normalizeClaimedAt(options.claimedAt)
      return serialize(async () => {
        if (server !== undefined) {
          return
        }

        const startingInstanceId = randomBytes(16).toString("hex")
        const startingPackageVersion = await readPackageVersion(packageFile)
        const startingToken = randomBytes(32).toString("hex")

        let boundServer
        let boundPort
        for (const candidatePort of preferredPorts(defaultPort)) {
          try {
            boundServer = await bindServer(
              candidatePort,
              startingInstanceId,
              startingToken,
              handleRequest
            )
            boundPort = boundServer.address().port
            break
          } catch (error) {
            if (!isAddressInUse(error)) {
              throw error
            }
          }
        }

        if (boundServer === undefined) {
          try {
            boundServer = await bindServer(0, startingInstanceId, startingToken, handleRequest)
            boundPort = boundServer.address().port
          } catch {
            notify("VS Code context bridge could not find an available local port.", "error")
            return
          }
        }

        instanceId = startingInstanceId
        packageVersion = startingPackageVersion
        token = startingToken
        claimedAt = restoredClaimedAt
        server = boundServer
        port = boundPort
        endpoint = `http://${HOST}:${port}`
        try {
          await writeInstanceState()
          await syncSharedPointer()
        } catch (error) {
          const failedServer = server
          const failedInstanceId = instanceId
          server = undefined
          endpoint = undefined
          port = undefined
          instanceId = undefined
          token = undefined
          claimedAt = 0
          await closeServer(failedServer)
          try {
            await removeInstanceState(failedInstanceId)
            await syncSharedPointer(failedInstanceId)
          } catch {}
          throw error
        }
      })
    },

    claim({ force = false, claimedAt: requestedClaimedAt } = {}) {
      let activityTime
      if (force) {
        const hasRequestedActivity = Number.isFinite(requestedClaimedAt) && requestedClaimedAt >= 0
        activityTime = hasRequestedActivity ? requestedClaimedAt : currentActivityTime()
        if (server !== undefined) {
          claimedAt = Math.max(claimedAt, activityTime)
        }
      }
      return serialize(async () => {
        if (server === undefined || instanceId === undefined) {
          return false
        }

        const selected = await resolveBridgeState(stateFile)
        if (!force && selected !== undefined && selected.instanceId !== instanceId) {
          return false
        }

        if (force) {
          claimedAt = Math.max(claimedAt, activityTime)
          await writeInstanceState()
        }
        await syncSharedPointer()
        return true
      })
    },

    close() {
      return serialize(async () => {
        if (server === undefined) {
          return
        }

        const closingServer = server
        const closingInstanceId = instanceId
        server = undefined
        endpoint = undefined
        port = undefined
        instanceId = undefined
        token = undefined
        claimedAt = 0

        await closeServer(closingServer)
        await removeInstanceState(closingInstanceId)
        await syncSharedPointer(closingInstanceId)
      })
    },

    get endpoint() {
      return endpoint
    },

    get claimedAt() {
      return claimedAt
    },

    get version() {
      return packageVersion
    },
  }

  function serialize(operation) {
    const result = lifecycle.then(operation, operation)
    lifecycle = result.catch(() => {})
    return result
  }

  async function handleRequest(
    request,
    response,
    requestServer,
    requestInstanceId,
    requestToken,
    requestEndpoint
  ) {
    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, {
        ok: true,
        instanceId: requestInstanceId,
        endpoint: requestEndpoint,
      })
      return
    }
    if (request.method !== "POST" || request.url !== "/context") {
      sendJson(response, 404, { error: "Not found" })
      return
    }
    if (request.headers.authorization !== `Bearer ${requestToken}`) {
      sendJson(response, 401, { error: "Unauthorized" })
      return
    }

    const identityHeader = request.headers["x-omp-instance-id"]
    if (identityHeader !== undefined && identityHeader !== requestInstanceId) {
      sendJson(response, 409, { error: "Bridge instance is no longer selected" })
      return
    }

    let body
    try {
      body = await readJsonBody(request)
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : "Invalid request body",
      })
      return
    }
    if (!isContextEnvelope(body)) {
      sendJson(response, 400, {
        error: "Expected a version 1 context envelope with source and prompt",
      })
      return
    }

    try {
      await serialize(async () => {
        if (!isCurrentRequest(requestServer, requestInstanceId, requestToken, requestEndpoint)) {
          sendJson(response, 409, { error: "Bridge instance is no longer active" })
          return
        }
        if (identityHeader !== undefined) {
          const selected = await resolveBridgeState(stateFile)
          if (
            selected === undefined ||
            selected.instanceId !== requestInstanceId ||
            !isCurrentRequest(requestServer, requestInstanceId, requestToken, requestEndpoint)
          ) {
            sendJson(response, 409, { error: "Bridge instance is no longer selected" })
            return
          }
        }

        await deliverPrompt(body.prompt)
        sendJson(response, 200, { ok: true })
      })
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : "Failed to deliver context",
      })
    }
  }

  function isCurrentRequest(requestServer, requestInstanceId, requestToken, requestEndpoint) {
    return (
      server === requestServer &&
      instanceId === requestInstanceId &&
      token === requestToken &&
      endpoint === requestEndpoint
    )
  }

  async function writeInstanceState() {
    const state = currentState()
    const registryDirectory = `${stateFile}.d`
    await mkdir(registryDirectory, { recursive: true, mode: 0o700 })
    await chmod(registryDirectory, 0o700)
    await atomicWrite(join(registryDirectory, `${instanceId}.json`), state)
  }

  function currentState() {
    return {
      endpoint,
      port,
      token,
      pid: process.pid,
      instanceId,
      version: packageVersion,
      updatedAt: new Date().toISOString(),
      claimedAt,
    }
  }

  async function syncSharedPointer(closingInstanceId) {
    const selected = await resolveBridgeState(stateFile)
    if (selected !== undefined) {
      await atomicWrite(stateFile, selected)
      return
    }
    if (closingInstanceId !== undefined) {
      await removePointerIfOwned(closingInstanceId)
    }
  }

  async function removeInstanceState(closingInstanceId) {
    await rm(join(`${stateFile}.d`, `${closingInstanceId}.json`), { force: true })
  }

  async function removePointerIfOwned(closingInstanceId) {
    const closingStateFile = `${stateFile}.${closingInstanceId}.${randomBytes(8).toString("hex")}.closing`
    try {
      const state = JSON.parse(await readFile(stateFile, "utf8"))
      if (state.instanceId !== closingInstanceId) {
        return
      }
    } catch {
      return
    }
    try {
      await rename(stateFile, closingStateFile)
    } catch {
      return
    }

    let removeClosingStateFile = false
    try {
      let closingInstanceIdFromPointer
      try {
        closingInstanceIdFromPointer = JSON.parse(
          await readFile(closingStateFile, "utf8")
        ).instanceId
      } catch {}

      if (closingInstanceIdFromPointer === closingInstanceId) {
        removeClosingStateFile = true
      } else {
        try {
          await link(closingStateFile, stateFile)
          removeClosingStateFile = true
        } catch (error) {
          removeClosingStateFile = error?.code === "EEXIST"
        }
      }
    } finally {
      if (removeClosingStateFile) {
        await rm(closingStateFile, { force: true })
      }
    }
  }
}

async function bindServer(port, instanceId, token, requestHandler) {
  let boundEndpoint
  const candidateServer = createServer((request, response) => {
    void requestHandler(request, response, candidateServer, instanceId, token, boundEndpoint)
  })
  try {
    await listen(candidateServer, port)
    boundEndpoint = `http://${HOST}:${candidateServer.address().port}`
    return candidateServer
  } catch (error) {
    try {
      candidateServer.close(() => {})
    } catch {}
    throw error
  }
}

function preferredPorts(defaultPort) {
  if (defaultPort === 0) {
    return [0]
  }
  if (!Number.isInteger(defaultPort) || defaultPort < 1 || defaultPort > 65535) {
    return []
  }
  return Array.from({ length: MAX_PORT_ATTEMPTS }, (_, offset) => defaultPort + offset).filter(
    (port) => port <= 65535
  )
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening)
      reject(error)
    }
    const onListening = () => {
      server.off("error", onError)
      resolve()
    }
    server.once("error", onError)
    server.once("listening", onListening)
    server.listen(port, HOST)
  })
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve())
    server.closeAllConnections?.()
  })
}

async function atomicWrite(path, state) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporaryStateFile = `${path}.${randomBytes(8).toString("hex")}.tmp`
  try {
    await writeFile(temporaryStateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    await chmod(temporaryStateFile, 0o600)
    await rename(temporaryStateFile, path)
  } finally {
    await rm(temporaryStateFile, { force: true })
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    request.on("data", (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large"))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")))
      } catch {
        reject(new Error("Request body is not valid JSON"))
      }
    })
    request.on("error", reject)
  })
}

async function readPackageVersion(packageFile) {
  const packageJson = JSON.parse(await readFile(packageFile, "utf8"))
  return typeof packageJson.version === "string" ? packageJson.version : "unknown"
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "application/json" })
  response.end(JSON.stringify(body))
}

function currentActivityTime() {
  return performance.timeOrigin + performance.now()
}

function normalizeClaimedAt(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function isAddressInUse(error) {
  return typeof error === "object" && error !== null && error.code === "EADDRINUSE"
}

export function isContextEnvelope(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }

  const candidate = value
  if (
    candidate.version !== 1 ||
    (candidate.source !== "vscode" &&
      candidate.source !== "firefox" &&
      candidate.source !== "ptyxis") ||
    typeof candidate.prompt !== "string" ||
    candidate.prompt.length === 0
  ) {
    return false
  }

  if (candidate.metadata === undefined) {
    return true
  }
  if (
    typeof candidate.metadata !== "object" ||
    candidate.metadata === null ||
    Array.isArray(candidate.metadata)
  ) {
    return false
  }

  return (
    (candidate.metadata.url === undefined || typeof candidate.metadata.url === "string") &&
    (candidate.metadata.title === undefined || typeof candidate.metadata.title === "string")
  )
}
