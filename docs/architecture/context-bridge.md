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
| Desktop companion   | GNOME Shell's GJS environment                                                        | JavaScript imports GNOME APIs. Node-based lifecycle tests do not replace a real GNOME activation check.                                                           |

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

Each running OMP console owns an endpoint, token, process identity, and instance identity. Per-console records support discovery of multiple running terminals; the shared pointer represents the selected console. Discovery validates loopback endpoints and probes `/health` for the expected instance identity. A confirmed dead or reused instance may be skipped; an ambiguous health failure is not proof that the owner is dead and must not silently route context elsewhere.

Records live in `~/.omp/agent/editor-context-bridge.json.d/`; `~/.omp/agent/editor-context-bridge.json` is the shared selected-console pointer. Each record contains the endpoint, bearer token, PID, random instance identity, package version, update timestamp, and `claimedAt` activity time. Activity order is independent of delayed pointer writes; background startup uses zero. State files are mode `0600` and the per-console directory is `0700`, enforced by `omp/bridge-runtime.js`.

The VS Code client sends the discovered instance identity with automatic delivery. The bridge rejects stale identity or selection before insertion. A definitive authentication or stale-selection rejection can trigger a fresh discovery; an ambiguous request failure must not be replayed automatically because the first insertion may have succeeded. Preserve this at-most-once boundary when changing retry or routing logic.

Discovery is bounded to 1.5 seconds, with a 500 ms limit per health probe. These current limits and exact response handling live in `omp/bridge-discovery.js`, `omp/bridge-runtime.js`, and `vscode/bridge-client.ts`; update this page alongside a change to those boundaries.

## Session and reload boundaries

OMP sessions can coexist, so selecting a console is a routing decision, not just a port lookup. Starting a background session should not steal the selected live console; explicit session changes and local terminal activity can select the current one. Closing a console removes only its own state and can promote a live survivor. The bridge preserves activity if its module is replaced in the same process; a new process is different and receives new endpoint credentials.

### Terminal input ownership

An enabled Linux console keeps a process-lifetime stdin guard as well as OMP's `onTerminalInput` subscription. The guard runs before OMP's stdin handler and reattaches the UI subscription for each incoming chunk. It does not read, consume, or classify input, select a console, or poll. The existing UI handler remains the only input parser and activity-claim path; reattachment preserves partial focus reports and prior focus observation.

This boundary matters because OMP can remove extension input listeners before a cancellable session transition. If an earlier extension cancels, Send Context receives neither its before-switch hook nor a completed switch event. A saved unsubscribe function therefore does not prove that OMP still has the listener. The guard is removed on opt-out and shutdown, including module replacement during reload; `/ide` can still explicitly rearm focus reporting and select the console without pinning it.

The runtime ordering is evidenced in OMP 18.11.1's [session preparation](https://github.com/can1357/oh-my-pi/blob/v18.11.1/packages/coding-agent/src/modes/interactive-mode.ts), [cancellable event dispatch](https://github.com/can1357/oh-my-pi/blob/v18.11.1/packages/coding-agent/src/extensibility/extensions/runner.ts), and [terminal stdin handling](https://github.com/can1357/oh-my-pi/blob/v18.11.1/packages/tui/src/terminal.ts). Recheck that ordering when upgrading OMP; see [focus lifecycle QA](/docs/qa-scenarios/omp-focus.md).

On OMP 18.11.1, [`/reload-plugins`](https://github.com/can1357/oh-my-pi/blob/v18.11.1/packages/coding-agent/src/slash-commands/builtin-marketplace.ts) refreshes plugin resources and MCP state but does not replace loaded extension modules. Its success notification is not evidence of new runtime code, even in the console where it was invoked. For runtime-release QA, start a fresh OMP process and reload/restart the client before concluding that the installed artifact is exercised. See the [release workflow](../workflows/release.md).

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
