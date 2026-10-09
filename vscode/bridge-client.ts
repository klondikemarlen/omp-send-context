import { resolveBridgeState } from "../omp/bridge-discovery.js"
import type { ContextEnvelope } from "./prompt"

const REQUEST_TIMEOUT_MILLISECONDS = 2_000
const MAX_DISCOVERY_RETRIES = 1

interface BridgeResponse {
  readonly ok: boolean
  readonly status: number
  readonly text: string
}

export async function sendBridgeContext(
  stateFile: string,
  request: ContextEnvelope,
  configuredEndpoint?: string
): Promise<void> {
  const endpointOverride = configuredEndpoint?.trim() || undefined
  let bridgeState = await resolveBridgeState(
    stateFile,
    endpointOverride === undefined ? undefined : { endpoint: endpointOverride }
  )

  if (bridgeState === undefined) {
    throw new Error("No healthy OMP context bridge is available")
  }

  for (let attempt = 0; ; attempt += 1) {
    const response = await postContext(
      bridgeState.endpoint,
      bridgeState.token,
      endpointOverride === undefined ? bridgeState.instanceId : undefined,
      request
    )

    if (response.ok) {
      return
    }

    if ((response.status !== 401 && response.status !== 409) || attempt >= MAX_DISCOVERY_RETRIES) {
      throw new Error(`OMP bridge returned ${response.status}: ${response.text}`)
    }

    bridgeState = await resolveBridgeState(
      stateFile,
      endpointOverride === undefined ? undefined : { endpoint: endpointOverride }
    )

    if (bridgeState === undefined) {
      throw new Error(`No healthy OMP context bridge is available after HTTP ${response.status}`)
    }
  }
}

async function postContext(
  endpoint: string,
  token: string,
  instanceId: string | undefined,
  request: ContextEnvelope
): Promise<BridgeResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MILLISECONDS)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  }

  if (instanceId !== undefined) {
    headers["X-OMP-Instance-Id"] = instanceId
  }

  try {
    const response = await fetch(`${endpoint}/context`, {
      method: "POST",
      redirect: "error",
      headers,
      body: JSON.stringify(request),
      signal: controller.signal,
    })
    let responseText = ""

    if (!response.ok) {
      try {
        responseText = await response.text()
      } catch {
        // Keep the explicit HTTP status when the response body times out or disconnects.
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      text: responseText,
    }
  } finally {
    clearTimeout(timeout)
  }
}
