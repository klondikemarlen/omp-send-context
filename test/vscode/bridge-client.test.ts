import assert from "node:assert/strict"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test, { type TestContext } from "node:test"

import { sendBridgeContext } from "../../vscode/bridge-client"
import type { ContextEnvelope } from "../../vscode/prompt"

interface BridgeStateFixture {
  readonly endpoint: string
  readonly token: string
  readonly instanceId: string
  readonly claimedAt: number
  readonly port: number
  readonly pid: number
  readonly version: string
  readonly updatedAt: string
}

interface ContextRequest {
  readonly authorization: string | undefined
  readonly instanceId: string | undefined
  readonly envelope: ContextEnvelope
}

interface TestBridge {
  readonly endpoint: string
}

type ContextHandler = (
  request: ContextRequest,
  response: ServerResponse<IncomingMessage>
) => void | Promise<void>

const ENVELOPE: ContextEnvelope = {
  version: 1,
  source: "vscode",
  prompt: "@src/example.ts#L4C2-L4C8\n\nselected text",
}

test("refreshes credentials and identity after an explicit 401", async (t) => {
  const stateFile = await createStateFile(t)
  let registeredInitialState: BridgeStateFixture | undefined
  let updatedState: BridgeStateFixture | undefined
  let initialRequest: ContextRequest | undefined
  let refreshedRequest: ContextRequest | undefined

  const initialBridge = await startBridge(t, "old-owner", async (request, response) => {
    initialRequest = request
    assert.equal(request.authorization, "Bearer old-token")
    assert.equal(request.instanceId, "old-owner")
    assert.equal(request.envelope.prompt, ENVELOPE.prompt)

    assert.ok(registeredInitialState)
    assert.ok(updatedState)
    await writeBridgeStates(stateFile, [registeredInitialState, updatedState], updatedState)
    response.writeHead(401, { "Content-Type": "text/plain" }).end("credentials changed")
  })
  const refreshedBridge = await startBridge(t, "new-owner", (request, response) => {
    refreshedRequest = request
    assert.equal(request.authorization, "Bearer new-token")
    assert.equal(request.instanceId, "new-owner")
    response.writeHead(200).end("delivered")
  })

  registeredInitialState = bridgeState(initialBridge.endpoint, "old-token", "old-owner", 10)
  updatedState = bridgeState(refreshedBridge.endpoint, "new-token", "new-owner", 20)
  await writeBridgeStates(stateFile, [registeredInitialState], registeredInitialState)

  await sendBridgeContext(stateFile, ENVELOPE)

  assert.equal(initialRequest?.authorization, "Bearer old-token")
  assert.equal(refreshedRequest?.authorization, "Bearer new-token")
  assert.equal(refreshedRequest?.instanceId, "new-owner")
  assert.equal(initialRequest?.envelope.prompt, ENVELOPE.prompt)
})

test("reroutes after an explicit 409 to the newly selected bridge", async (t) => {
  const stateFile = await createStateFile(t)
  let nextState: BridgeStateFixture | undefined
  let oldState: BridgeStateFixture | undefined
  let oldBridgePosts = 0
  let newBridgePosts = 0
  let newBridgeRequest: ContextRequest | undefined

  const oldBridge = await startBridge(t, "old-owner", async (_request, response) => {
    oldBridgePosts += 1
    assert.ok(oldState)
    assert.ok(nextState)
    await writeBridgeStates(stateFile, [oldState, nextState], nextState)
    response.writeHead(409, { "Content-Type": "text/plain" }).end("owner changed")
  })
  const newBridge = await startBridge(t, "new-owner", (request, response) => {
    newBridgePosts += 1
    newBridgeRequest = request
    response.writeHead(200).end("delivered")
  })

  oldState = bridgeState(oldBridge.endpoint, "old-token", "old-owner", 10)
  nextState = bridgeState(newBridge.endpoint, "new-token", "new-owner", 20)
  await writeBridgeStates(stateFile, [oldState], oldState)

  await sendBridgeContext(stateFile, ENVELOPE)

  assert.equal(oldBridgePosts, 1)
  assert.equal(newBridgePosts, 1)
  assert.equal(newBridgeRequest?.authorization, "Bearer new-token")
  assert.equal(newBridgeRequest?.instanceId, "new-owner")
  assert.equal(newBridgeRequest?.envelope.prompt, ENVELOPE.prompt)
})

test("does not fall back to an unrelated bridge when discovery is dead", async (t) => {
  const stateFile = await createStateFile(t)
  let unrelatedPosts = 0
  await startBridge(t, "unrelated-owner", (_request, response) => {
    unrelatedPosts += 1
    response.writeHead(200).end("unexpected delivery")
  })
  const deadState = bridgeState("http://127.0.0.1:1", "dead-token", "dead-owner", 10)
  await writeBridgeStates(stateFile, [deadState], deadState)

  await assert.rejects(sendBridgeContext(stateFile, ENVELOPE), /No healthy OMP context bridge/)

  assert.equal(unrelatedPosts, 0)
})

test("does not POST to a reused endpoint with a different instance identity", async (t) => {
  const stateFile = await createStateFile(t)
  let healthRequests = 0
  let contextRequests = 0
  const staleBridge = await startBridge(
    t,
    "replacement-owner",
    (_request, response) => {
      contextRequests += 1
      response.writeHead(200).end("unexpected delivery")
    },
    () => {
      healthRequests += 1
    }
  )
  const staleState = bridgeState(staleBridge.endpoint, "stale-token", "stale-owner", 10)
  await writeBridgeStates(stateFile, [staleState], staleState)

  await assert.rejects(sendBridgeContext(stateFile, ENVELOPE), /No healthy OMP context bridge/)

  assert.equal(healthRequests, 1)
  assert.equal(contextRequests, 0)
})

test("keeps an endpoint override pinned and uses its matching credentials", async (t) => {
  const stateFile = await createStateFile(t)
  let automaticBridgePosts = 0
  let overrideBridgePosts = 0
  let overrideRequest: ContextRequest | undefined
  const automaticBridge = await startBridge(t, "automatic-owner", (_request, response) => {
    automaticBridgePosts += 1
    response.writeHead(200).end("wrong endpoint")
  })
  const overrideBridge = await startBridge(t, "override-owner", (request, response) => {
    overrideBridgePosts += 1
    overrideRequest = request
    response.writeHead(200).end("delivered")
  })
  const automaticState = bridgeState(
    automaticBridge.endpoint,
    "automatic-token",
    "automatic-owner",
    20
  )
  const overrideState = bridgeState(overrideBridge.endpoint, "override-token", "override-owner", 10)
  await writeBridgeStates(stateFile, [automaticState, overrideState], automaticState)

  await sendBridgeContext(stateFile, ENVELOPE, overrideBridge.endpoint)

  assert.equal(overrideBridgePosts, 1)
  assert.equal(automaticBridgePosts, 0)
  assert.equal(overrideRequest?.authorization, "Bearer override-token")
  assert.equal(overrideRequest?.instanceId, undefined)
  assert.equal(overrideRequest?.envelope.prompt, ENVELOPE.prompt)
})

test("does not retry an ambiguous POST failure after the server receives it", async (t) => {
  const stateFile = await createStateFile(t)
  let receivedPosts = 0
  const bridge = await startBridge(t, "ambiguous-owner", (_request, response) => {
    receivedPosts += 1
    response.destroy()
  })
  const state = bridgeState(bridge.endpoint, "ambiguous-token", "ambiguous-owner", 10)
  await writeBridgeStates(stateFile, [state], state)

  await assert.rejects(sendBridgeContext(stateFile, ENVELOPE))

  assert.equal(receivedPosts, 1)
})

test("does not follow a context redirect to another console", async (t) => {
  const stateFile = await createStateFile(t)
  let wrongConsolePosts = 0
  const wrongConsole = await startBridge(t, "wrong-owner", (_request, response) => {
    wrongConsolePosts += 1
    response.writeHead(200).end()
  })
  const selectedConsole = await startBridge(t, "selected-owner", (_request, response) => {
    response.writeHead(307, { Location: `${wrongConsole.endpoint}/context` }).end()
  })
  const state = bridgeState(selectedConsole.endpoint, "selected-token", "selected-owner", 10)
  await writeBridgeStates(stateFile, [state], state)

  await assert.rejects(sendBridgeContext(stateFile, ENVELOPE))
  assert.equal(wrongConsolePosts, 0)
})

async function createStateFile(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "omp-vscode-bridge-client-"))
  t.after(async () => rm(directory, { recursive: true, force: true }))
  return path.join(directory, "editor-context-bridge.json")
}

async function writeBridgeStates(
  stateFile: string,
  states: readonly BridgeStateFixture[],
  selectedState: BridgeStateFixture
) {
  const stateDirectory = `${stateFile}.d`
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 })

  for (const state of states) {
    const recordPath = path.join(stateDirectory, `${state.instanceId}.json`)
    await writeFile(recordPath, `${JSON.stringify(state)}\n`, { mode: 0o600 })
  }

  await writeFile(stateFile, `${JSON.stringify(selectedState)}\n`, { mode: 0o600 })
}

function bridgeState(
  endpoint: string,
  token: string,
  instanceId: string,
  claimedAt: number
): BridgeStateFixture {
  return {
    endpoint,
    token,
    instanceId,
    claimedAt,
    port: Number(new URL(endpoint).port),
    pid: process.pid,
    version: "2.6.0",
    updatedAt: new Date(claimedAt).toISOString(),
  }
}

async function startBridge(
  t: TestContext,
  healthyInstanceId: string,
  onContext: ContextHandler,
  onHealth?: () => void
): Promise<TestBridge> {
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      onHealth?.()
      response
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ ok: true, instanceId: healthyInstanceId }))
      return
    }

    if (request.method === "POST" && request.url === "/context") {
      const body = await readJsonRequest(request)
      const headerValue = request.headers["x-omp-instance-id"]
      await onContext(
        {
          authorization: request.headers.authorization,
          instanceId: Array.isArray(headerValue) ? headerValue[0] : headerValue,
          envelope: body,
        },
        response
      )
      return
    }

    response.writeHead(404).end("not found")
  })

  server.listen(0, "127.0.0.1")
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve)
    server.once("error", reject)
  })

  const address = server.address()
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP bridge test server")
  }

  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  })

  return {
    endpoint: `http://127.0.0.1:${address.port}`,
  }
}

async function readJsonRequest(request: IncomingMessage): Promise<ContextEnvelope> {
  let body = ""
  for await (const chunk of request) {
    body += chunk
  }
  return JSON.parse(body) as ContextEnvelope
}
