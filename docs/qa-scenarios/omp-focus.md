# OMP focus lifecycle QA

Use this scenario when changing OMP focus routing, subscription ownership, or session/reload behavior, and after an OMP upgrade changes terminal dispatch. It verifies automatic recovery, not merely whether `/ide` can repair a console. Product semantics belong in the [editor guide](/docs/product/editor.md); input ownership belongs in the [bridge architecture](/docs/architecture/context-bridge.md#terminal-input-ownership).

## Prerequisites

- Two fresh Linux OMP processes, A and B, with the released GitHub plugin installed and autofocus enabled. Record `omp --version` and each process's `/ide status` version before exercising the scenario.
- A terminal forwarding xterm focus reports. A PTY harness may inject `ESC [ I` and `ESC [ O` to exercise dispatch deterministically; this proves OMP input handling, not physical window-manager focus forwarding.
- An authenticated context producer. Use the editor shortcut or the bridge HTTP API with locally read credentials; never publish bearer tokens, complete bridge records, private prompts, or account configuration.
- For cancellation, a temporary extension that registers before or after Send Context in an isolated QA process:

```js
export default function cancelSessionChanges(pi) {
  pi.on("session_before_switch", () => ({ cancel: true }))
}
```

Load explicit extensions with `--no-extensions -e /path/to/cancel.js -e /path/to/omp/index.js` to establish earlier cancellation, then reverse their order for later cancellation. Use an isolated HOME and session directory so this helper cannot affect ordinary sessions. Do not install the cancellation helper as a normal user plugin.

## Session transitions and delivery

1. Select A by focusing it, then select B. Deliver a unique harmless context marker. Only B's editor should contain the marker; it must not be submitted.
2. In A without the cancelling extension, run `/new`. Focus B, then A. Deliver another marker: only A receives it. Repeat a successful switch to catch subscription loss across multiple transitions.
3. Restart A with the cancelling extension **before** Send Context. Run `/new`, then focus B and refocus A. Do not run `/ide` or `/ide status` between cancellation and delivery: typing either is terminal activity and could mask the failed focus-only path. Only A receives the next marker without a manual reconnect.
4. Focus B, then send A a later focus-out. B must remain selected. Type ordinary draft text in A; A must become selected and receive the next context marker. Terminal probe replies alone must not select A.
5. Repeat cancellation with the extension **after** Send Context. Recovery must not depend on handler ordering or on a successful `session_switch` event.
6. Run `/ide` in A, then focus B and A again. Manual selection must not pin routing or duplicate subscriptions. Confirm `/ide ` plus Tab offers `status`.

## Opt-out and reload cleanup

1. Disable autofocus using the plugin setting. Attempt a cancelled `/new`, focus and type in that console, and confirm it does not claim automatically. Bare `/ide` may select it once but must not turn autofocus back on. Respect the documented per-process command-line override when choosing the QA setup.
2. Re-enable autofocus, run `/reload-plugins`, then focus B before refocusing A. A must not steal B's newer activity merely by refreshing resources, and must accept context when actually refocused. On OMP 18.11.1 this command does not replace loaded extension modules; use the behavioral regression suite to exercise shutdown/module-replacement cleanup, and a fresh OMP process to validate new runtime code.
3. Repeat reload and session transitions. Closing A must not leave an input guard that revives its closed bridge, interferes with B, or throws on later input.

## Evidence and cleanup

Record the loaded artifact/version, OMP version, cancellation ordering, input source (physical focus or injected PTY), HTTP result when applicable, and the observed destination prompt in the owning PR. A successful command notification or pointer update alone is not delivery proof. Run the focused behavioral regressions with `node --test test/omp/bridge.test.mjs`, then the documented `npm test` gate.

Stop only QA-owned processes and remove the temporary cancellation extension and isolated state. Preserve ordinary user consoles. A user-reported recurrence remains evidence even when one reproduced cause passes; distinguish unobserved terminal/multiplexer forwarding from verified OMP subscription behavior.
