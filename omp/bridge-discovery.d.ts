export interface BridgeState {
  readonly endpoint: string
  readonly token: string
  readonly instanceId: string
  readonly claimedAt?: number
  readonly port?: number
  readonly pid?: number
  readonly version?: string
  readonly updatedAt?: string
}

export interface ResolveBridgeStateOptions {
  readonly endpoint?: string
}

export function resolveBridgeState(
  stateFile: string,
  options?: ResolveBridgeStateOptions
): Promise<BridgeState | undefined>
