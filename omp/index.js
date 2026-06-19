import { randomBytes } from "node:crypto"
import { createServer } from "node:http"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const DEFAULT_PORT = Number.parseInt(process.env.OMP_CONTEXT_BRIDGE_PORT ?? "47687", 10)
const HOST = "127.0.0.1"
const MAX_PORT_ATTEMPTS = 20
const MAX_BODY_BYTES = 2 * 1024 * 1024
const STATE_FILE = join(homedir(), ".omp", "agent", "editor-context-bridge.json")

let activeContext
let server
let token
let serverEndpoint

export default function ompVscodeContextExtension(pi) {
  pi.setLabel("VS Code Context Bridge")

  pi.on("session_start", async (_event, ctx) => {
    activeContext = ctx
    await ensureServer(pi, ctx)
  })

  pi.on("session_switch", async (_event, ctx) => {
    activeContext = ctx
    await ensureServer(pi, ctx)
  })

  pi.on("session_shutdown", async () => {
    activeContext = undefined
    await closeServer()
  })
}

async function ensureServer(pi, ctx) {
  if (server !== undefined) {
    return
  }

  token = randomBytes(32).toString("hex")

  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    const port = DEFAULT_PORT + offset
    const candidateServer = createServer((request, response) => {
      void handleRequest(pi, request, response)
    })

    try {
      await listen(candidateServer, port)
      server = candidateServer
      serverEndpoint = `http://${HOST}:${port}`
      await writeStateFile(port)
      ctx.ui.notify(`VS Code context bridge listening on ${serverEndpoint}.`, "info")
      return
    } catch (error) {
      candidateServer.close()
      if (!isAddressInUse(error)) {
        throw error
      }
    }
  }

  ctx.ui.notify("VS Code context bridge could not find an available local port.", "error")
}

function listen(candidateServer, port) {
  return new Promise((resolve, reject) => {
    candidateServer.once("error", reject)
    candidateServer.listen(port, HOST, () => {
      candidateServer.off("error", reject)
      resolve()
    })
  })
}

async function handleRequest(pi, request, response) {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, {
      ok: true,
      endpoint: serverEndpoint,
    })
    return
  }

  if (request.method !== "POST" || request.url !== "/context") {
    sendJson(response, 404, {
      error: "Not found",
    })
    return
  }

  if (!isAuthorized(request)) {
    sendJson(response, 401, {
      error: "Unauthorized",
    })
    return
  }

  let body
  try {
    body = await readJsonBody(request)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request body"
    sendJson(response, 400, {
      error: message,
    })
    return
  }

  if (!isContextRequest(body)) {
    sendJson(response, 400, {
      error: "Expected a context request with a prompt string",
    })
    return
  }

  try {
    await deliverContext(pi, body)
    sendJson(response, 200, {
      ok: true,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to deliver context"
    sendJson(response, 500, {
      error: message,
    })
  }
}

function isAuthorized(request) {
  if (token === undefined) {
    return true
  }

  return request.headers.authorization === `Bearer ${token}`
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
        const rawBody = Buffer.concat(chunks).toString("utf8")
        resolve(JSON.parse(rawBody))
      } catch {
        reject(new Error("Request body is not valid JSON"))
      }
    })

    request.on("error", reject)
  })
}

function isContextRequest(value) {
  if (typeof value !== "object" || value === null) {
    return false
  }

  return typeof value.prompt === "string" && value.prompt.length > 0
}

async function deliverContext(pi, body) {
  if (body.delivery === "send") {
    await pi.sendUserMessage(body.prompt, { deliverAs: "steer" })
    activeContext?.ui?.notify?.("Sent VS Code context to OMP.", "info")
    return
  }

  if (body.delivery === "nextTurn") {
    await pi.sendUserMessage(body.prompt, { deliverAs: "nextTurn" })
    activeContext?.ui?.notify?.("Queued VS Code context for the next OMP turn.", "info")
    return
  }

  if (activeContext?.hasUI && typeof activeContext.ui?.pasteToEditor === "function") {
    await activeContext.ui.pasteToEditor(body.prompt)
    activeContext.ui.notify?.("Inserted VS Code context into the OMP prompt.", "info")
    return
  }

  await pi.sendUserMessage(body.prompt, { deliverAs: "nextTurn" })
}

async function writeStateFile(port) {
  const state = {
    endpoint: `http://${HOST}:${port}`,
    port,
    token,
    pid: process.pid,
    updatedAt: new Date().toISOString(),
  }

  await mkdir(join(homedir(), ".omp", "agent"), {
    recursive: true,
  })
  await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  })
}

async function closeServer() {
  if (server === undefined) {
    return
  }

  const closingServer = server
  server = undefined
  serverEndpoint = undefined
  token = undefined

  await new Promise((resolve) => {
    closingServer.close(() => resolve())
  })

  await rm(STATE_FILE, {
    force: true,
  })
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
  })
  response.end(JSON.stringify(body))
}

function isAddressInUse(error) {
  return typeof error === "object" && error !== null && error.code === "EADDRINUSE"
}
