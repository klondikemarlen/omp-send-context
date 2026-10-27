# Context bridge architecture

This page records the product-level concepts and the architecture boundaries contributors should preserve. It is not a promise that every supported or schema-permitted source has a shipped client. For current user-facing behavior, see [product documentation](../product/editor.md) and [product documentation for Firefox](../product/firefox.md); for observed test coverage, see the [Firefox QA scenario](../qa-scenarios/firefox.md).

## Responsibility boundaries

- A context client owns its source inspection: it reads selection, location, and any source-specific metadata, then builds prompt text. The client does not ask OMP to inspect its editor or browser.
- The OMP plugin owns the local bridge and prompt mutation. It receives context through the bridge and inserts the supplied prompt into OMP's editor; it does not submit the prompt automatically.
- The versioned envelope is the transport boundary between clients and the bridge. It keeps integrations independent of each other's source-specific code.

These are intended design boundaries. The code and its tests describe what the current implementation does; where they differ from this model, use the corresponding source and tests rather than treating this page as implementation evidence.

## Runtime and language boundaries

The integrations share a wire contract, not one execution environment. Keep source language and build ownership aligned with the host:

| Surface             | Execution environment                                                                | Language and build boundary                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Editor client       | VS Code-compatible extension host                                                    | TypeScript is checked by `tsc` and bundled to CommonJS by esbuild.                                                                                                |
| OMP bridge          | OMP extension process; Node-compatible APIs                                          | ESM JavaScript loads directly. The adjacent discovery declaration describes the TypeScript client's view; it does not type-check the JavaScript implementation.   |
| Firefox add-on      | Browser extension background/content contexts                                        | JavaScript is staged into the add-on with source-commit provenance; browser behavior still needs browser QA.                                                      |
| Firefox native host | Node for source-checkout installation; standalone executable for Debian installation | The JavaScript and Go hosts serve different installation paths. Both must preserve the envelope/framing contract; neither implementation's tests prove the other. |

A single-language rewrite would not remove these host APIs or distribution boundaries. The current split avoids adding a compiler to directly loaded integrations while keeping a standalone native host for packaged installs. Change a boundary when an observed correctness, type-safety, or maintenance problem justifies the migration and its installed-artifact checks, not merely to make the repository uniform.

## Request path

1. A user invokes a client action.
2. The client captures its available context and formats a prompt.
3. The client discovers the local OMP bridge and sends a versioned envelope to `POST /context` with bearer authentication.
4. The bridge validates the request and inserts the prompt into the selected OMP console.

For Firefox, the native-messaging host performs bridge discovery and authentication on behalf of the add-on; bearer tokens never enter the browser extension.

The bridge is local to the machine, not a public API. It binds to `127.0.0.1`, chooses an available port, and authenticates context requests with a random token. The running OMP process writes private state used by clients for discovery. Never treat the endpoint or a successful health response alone as authorization to send context.

## Envelope and source boundaries

The canonical wire shape is defined by [`protocol/context-envelope.schema.json`](https://github.com/klondikemarlen/omp-send-context/blob/main/protocol/context-envelope.schema.json), with an example in [`protocol/context-envelope.example.json`](https://github.com/klondikemarlen/omp-send-context/blob/main/protocol/context-envelope.example.json). The envelope carries a version, source name, prompt, and optional metadata such as URL and title. These source links target the repository because the runtime package does not include every client or protocol source.

The schema's source enum is a wire-contract allowance, not an inventory of clients or a claim that every allowed source has the same implementation status. Current source types, validators, and producer behavior must be checked in their implementation files. In particular, a source may be allowed by the shared schema without appearing in the VS Code client's narrower TypeScript source type. Keep wire compatibility separate from client implementation details.

The prompt is the bridge's payload; source-specific inspection remains at the client boundary. Inline content can preserve selected text as captured, while reference-only content is smaller and relies on the target runtime's ability to inspect the referenced file. Handoff packets may include optional workspace or diagnostic context according to client settings and limits; they are explicit user-triggered context, not background collection.

## Discovery, selection, and delivery safety

Each running OMP console owns an endpoint, token, process identity, and instance identity. Per-console records support discovery of multiple running terminals. Resolve the most recently active live record, using the shared pointer for legacy discovery and activity ties, not as an authoritative replacement for the registry. A delayed background startup or shutdown can overwrite that pointer after a newer claim. Discovery validates loopback endpoints and probes `/health` for the expected instance identity. A confirmed dead or reused instance may be skipped; an ambiguous health failure is not proof that the owner is dead and must not silently route context elsewhere.

Records live in `~/.omp/agent/editor-context-bridge.json.d/`; `~/.omp/agent/editor-context-bridge.json` is the shared selected-console pointer. Each record contains the endpoint, bearer token, PID, random instance identity, loaded package version, `protocolVersion`, update timestamp, and `claimedAt` activity time. Activity order is independent of delayed pointer writes; background startup uses zero. State files are mode `0600` and the per-console directory is `0700`, enforced by `omp/bridge-runtime.js`.

The VS Code client and both Firefox native hosts send the discovered instance identity with automatic delivery. The bridge rejects stale identity or selection before insertion. VS Code can rediscover after a definitive authentication or stale-selection rejection; Firefox returns a native-delivery error for that request and the add-on uses its existing clipboard fallback. Neither path replays an ambiguous request failure because the first insertion may have succeeded. Redirects must not carry the request to another destination.

Discovery is bounded to 1.5 seconds, with a 500 ms limit per health probe. The source-checkout Firefox host reuses `omp/bridge-discovery.js`; the standalone packaged Go host implements the same ordering, liveness, identity, and ambiguity contract in `firefox/native-host/discovery.go`. Check both consumers when changing discovery semantics; a working editor client or `/ide` notification does not prove Firefox routing. Exact response handling also lives in `omp/bridge-runtime.js` and `vscode/bridge-client.ts`.

### Cross-process activity and version contract

Routing protocol 1 keeps the existing record fields, loopback health identity, bearer-authenticated `/context`, and version 1 envelopes. Package major versions are not routing protocol versions: compatible packages can coexist without matching their release numbers. Additive metadata must not change selection or authorization; incompatible future changes need an explicit protocol migration rather than silently reinterpreting old records.

`claimedAt` is epoch wall-clock milliseconds captured at the user activity, using `Date.now()`. Zero means no observed activity. Do not persist `performance.timeOrigin + performance.now()`: Linux suspend can leave an older process's performance clock hours behind a newly started process, so later focus never outranks the restarted console. Monotonic performance time remains appropriate for local discovery deadlines, not shared activity ordering. `updatedAt` records a write, not activity; reconnecting must not promote it into a claim.

`GET /health` returns `ok`, `instanceId`, `endpoint`, `pid`, `version` (the running bridge's loaded package version), and `protocolVersion: 1`. It never returns the bearer token or prompt contents and never claims routing. Controllers can match a private registry record to the child's PID, then verify its live health identity before displaying version information. A stale record, reused PID, installed-on-disk version, or missing health field is not proof of the running plugin version. Older health responses without metadata remain valid for existing discovery; external diagnostics should show unavailable fields as unknown.

Version 2.8.0 is the suspend-safe baseline. Pre-baseline processes retain their old activity clock until restarted; a new release cannot replace code already loaded in another process. Once every console reaches that baseline, future protocol-compatible releases may be adopted independently. The instance-control consumer is coordinated in [omp-instance-control #58](https://github.com/klondikemarlen/omp-instance-control/issues/58).

## Session and reload boundaries

OMP sessions can coexist, so selecting a console is a routing decision, not just a port lookup. Session startup, restart, and switching reconnect the bridge and input listener without inventing activity. Only observed focus-in, keyboard input, and explicit `/ide` select a console. Closing a console removes only its own state and can promote a live survivor. The bridge preserves activity if its module is replaced in the same process; a new process is different and receives new endpoint credentials. The `ompi` launcher and its replacement OMP children have separate instance-control identities; those identities do not participate in context discovery.

### Terminal input ownership

An enabled Linux console keeps a process-lifetime stdin guard as well as OMP's `onTerminalInput` subscription. The guard runs before OMP's stdin handler and reattaches the UI subscription for each incoming chunk. It does not read, consume, or classify input, select a console, or poll. The UI handler remains the only activity-claim path; input framing belongs to OMP's terminal parser, not to the subscription guard or this plugin.

`omp/terminal-activity.js` classifies complete terminal events without state, filesystem access, or bridge side effects. Exact focus-in selects the console; exact focus-out is consumed without selecting it. Every other event is forwarded unchanged, including standalone Escape and bracketed paste containing focus-like text. The classifier never buffers a prefix while waiting for another key. Capability responses, including SIXEL graphics replies, and SGR/X10 mouse reports are not keyboard activity. Mouse movement can arrive without focus. A first focus-out is not evidence of a new focus-in and must never supersede another console's activity.

The [OMP 16.5.1 terminal source](https://github.com/can1357/oh-my-pi/blob/v16.5.1/packages/tui/src/terminal.ts) and [OMP 18.12.6 terminal source](https://github.com/can1357/oh-my-pi/blob/v18.12.6/packages/tui/src/terminal.ts) both use `StdinBuffer` to resolve standalone Escape and assemble split raw input before UI dispatch. They deliver bracketed paste as a complete event. Buffering Escape again in an extension hides a resolved key from selectors and may combine it with later typing. Test raw fragmentation through a real PTY; pass complete events to classifier and extension-listener tests.

OMP 18.12.6 also probes terminal capabilities and enables mouse reporting for fullscreen surfaces. Real-runtime PTY QA established that SIXEL replies and mouse motion can reach this plugin's input listener; treating every unrecognized escape sequence as typing therefore changes routing without user intent. Keep classification distinct from bridge ranking: correct registry discovery cannot repair a false activity timestamp.

This boundary matters because OMP can remove extension input listeners before a cancellable session transition. If an earlier extension cancels, Send Context receives neither its before-switch hook nor a completed switch event. A saved unsubscribe function therefore does not prove that OMP still has the listener. The guard is removed on opt-out and shutdown, including module replacement during reload; `/ide` can still explicitly rearm focus reporting and select the console without pinning it.

The runtime ordering is evidenced in OMP 18.11.1's [session preparation](https://github.com/can1357/oh-my-pi/blob/v18.11.1/packages/coding-agent/src/modes/interactive-mode.ts), [cancellable event dispatch](https://github.com/can1357/oh-my-pi/blob/v18.11.1/packages/coding-agent/src/extensibility/extensions/runner.ts), and [terminal stdin handling](https://github.com/can1357/oh-my-pi/blob/v18.11.1/packages/tui/src/terminal.ts). Recheck that ordering when upgrading OMP; see [focus lifecycle QA](/docs/qa-scenarios/omp-focus.md).

On OMP 18.11.1, [`/reload-plugins`](https://github.com/can1357/oh-my-pi/blob/v18.11.1/packages/coding-agent/src/slash-commands/builtin-marketplace.ts) refreshes plugin resources and MCP state but does not replace loaded extension modules. Its success notification is not evidence of new runtime code, even in the console where it was invoked. For runtime-release QA, start a fresh OMP process and reload/restart the client before concluding that the installed artifact is exercised. See the [release workflow](../workflows/release.md).

### Passive diagnostics

The global plugin `diagnostics` setting is independent of autofocus. Every interactive console watches it, including consoles with autofocus disabled or forced on by a flag. A diagnostics-only setting change must not rebind input listeners, emit terminal mode controls, start a missing bridge, or claim selection. Headless contexts do not start diagnostic watchers.

`omp/routing-diagnostics.js` owns allowlisted event/snapshot serialization, private per-registration JSON Lines files, bounded rotation, and timer/write cleanup. It samples local metadata and receives categories from the existing input path; it adds no stdin listener, UI input subscription, terminal query, health probe, or recovery path. A stored subscription handle indicates registration, not proof that OMP still retains its callback. Diagnostic I/O failures must not interrupt routing, and arbitrary error messages must not enter the log. Operator controls and retention belong in [Troubleshooting](/docs/product/troubleshooting.md#global-routing-diagnostics).

## Security and privacy boundaries

- Bind the bridge only to loopback; do not expose it on a network interface.
- Treat the bearer token and bridge state as credentials. Keep state files private and do not log tokens or prompt contents.
- Validate endpoint and instance identity before delivery; do not equate timeout with a confirmed-dead owner.
- Context is sent only after an explicit user action. It can include selected text, local paths, and optional diagnostics; the user remains responsible for reviewing the prompt before submitting it to an agent.

The implementation's exact filesystem permissions, validation rules, request bounds, and redaction behavior are code-level facts. Verify those in the bridge/client code and tests before making operational claims here.

## Related knowledge

- [Editor product behavior](../product/editor.md)
- [Firefox product behavior](../product/firefox.md)
- [Troubleshooting](../product/troubleshooting.md)
- [Development workflow](../workflows/development.md)
- [Release workflow](../workflows/release.md)
- [Firefox QA scenario](../qa-scenarios/firefox.md)
