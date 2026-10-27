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

## Escape and input framing

Use a fresh process with autofocus enabled. To open a reproducible standard selector, load this temporary extension alongside Send Context in the isolated QA environment:

```js
export default function focusSelectorQa(pi) {
  pi.registerCommand("focus-qa-select", {
    handler: async (_args, ctx) => {
      const choice = await ctx.ui.select("Focus QA selector", [
        "Keep editing",
        "Choose another option",
      ])
      if (choice === undefined) {
        ctx.ui.notify("Focus QA selection cancelled.", "info")
        return
      }

      ctx.ui.notify(`Focus QA selected: ${choice}`, "info")
    },
  })
}
```

1. Run `/focus-qa-select`, wait until its selector is visible, then press Escape once. The selector must close and report cancellation without another key. Type ordinary draft text next; no buffered Escape may change it.
2. Paste multiline text and verify the prompt preserves it without submission. Classifier coverage also checks that focus-like escape text inside bracketed paste remains opaque to this plugin.
3. Select another live console. In the tested console's real PTY, write `ESC`, `[`, and `I` in separate writes within OMP's input-framing interval. Deliver a unique context marker before any command entry. Only the tested console receives it, with no report bytes inserted into its prompt.
4. Repeat complete focus-in/focus-out, capability-reply, and mouse-report checks. Only genuine keyboard or focus-in activity may change the target.

OMP owns raw-byte assembly and standalone-Escape timing. Calling `onTerminalInput` directly with incomplete bytes tests an invented extension contract and can hide duplicate buffering. Keep permanent classifier tests at the complete-event boundary and record split-byte evidence from the actual runtime.

## Session transitions and delivery

1. Select A by focusing it, then select B. Deliver a unique harmless context marker. Only B's editor should contain the marker; it must not be submitted.
2. In A without the cancelling extension, run `/new`. Focus B, then A. Deliver another marker: only A receives it. Repeat a successful switch to catch subscription loss across multiple transitions.
3. Restart A with the cancelling extension **before** Send Context. Run `/new`, then focus B and refocus A. Do not run `/ide` or `/ide status` between cancellation and delivery: typing either is terminal activity and could mask the failed focus-only path. Only A receives the next marker without a manual reconnect.
4. Focus B, then send A a later focus-out, including A's first focus-out after startup. B must remain selected. Type ordinary draft text in A; A must become selected and receive the next context marker. Terminal capability replies and mouse reports alone must not select A.
5. Repeat cancellation with the extension **after** Send Context. Recovery must not depend on handler ordering or on a successful `session_switch` event.
6. Run `/ide` in A, then focus B and A again. Manual selection must not pin routing or duplicate subscriptions. Confirm `/ide ` plus Tab offers `status`.

## Independent terminal restarts

Use several terminals, including both direct OMP and actual `ompi` launchers; nine terminals exercises the reported workload. Keep HOME, the OMP agent/config directories, and `XDG_RUNTIME_DIR` isolated from personal sessions. The configuration ancestors must not be group/world-writable. Use a short private runtime path: the wrapper's Unix-socket path must fit the platform limit.

Do not pass `--no-extensions` to a wrapped launch: `ompi` treats that as ordinary OMP passthrough without launcher management. An isolated HOME lets normal wrapped launches load only explicit QA extensions and the wrapper's own adapter. Confirm `ompi control list --json` sees the expected online QA children before restarting anything. Use OMP's real session persistence to create resumable QA sessions; do not fabricate transcripts.

1. Focus a target console, then externally restart a different wrapped child with `ompi control restart FULL_INSTANCE_ID`. Confirm the replacement reports the predecessor identity; disappearance alone is not completion.
2. Without typing in the target, deliver through the actual context producer and inspect every prompt. Only the target should contain the unique marker.
3. After restart, send background consoles a SIXEL reply (`ESC [ ? 2 ; 0 ; 256 S`), mouse motion (`ESC [ < 35 ; 12 ; 5 M`), and focus-out. These reports must not take ownership. Send another marker and inspect all prompts again.
4. Focus the restarted console and send a marker; it should now receive context. Repeat with different restarted and target consoles, leaving the other processes untouched.
5. Repeat a direct OMP process restart, then verify focus-only selection in an untouched survivor. Do not use `/ide`, `/restart`, or command entry in that survivor as preparation for the assertion.
6. Exercise a suspend-spanning survivor alongside a post-resume replacement. A process-local performance-clock offset can reproduce the ordering boundary without suspending the workstation. Focus the survivor and deliver before command entry: its later activity must win. This simulation does not establish physical suspend or compositor behavior.
7. Query live `/health` metadata without terminal input. Verify each identity and loaded version independently of installed files; polling metadata must not change the selected console. Repeat with different package versions implementing the same routing protocol. This proves protocol compatibility, not arbitrary future-version correctness.

Injected reports establish dispatch and routing, not compositor forwarding. Record actual Ptyxis/window-focus coverage separately. Stop only the verified QA launcher/child identities and remove their private state after observation.

## Opt-out and reload cleanup

1. Disable autofocus using the plugin setting. Attempt a cancelled `/new`, focus and type in that console, and confirm it does not claim automatically. Bare `/ide` may select it once but must not turn autofocus back on. Respect the documented per-process command-line override when choosing the QA setup.
2. Re-enable autofocus, run `/reload-plugins`, then focus B before refocusing A. A must not steal B's newer activity merely by refreshing resources, and must accept context when actually refocused. On OMP 18.11.1 this command does not replace loaded extension modules; use the behavioral regression suite to exercise shutdown/module-replacement cleanup, and a fresh OMP process to validate new runtime code.
3. Repeat reload and session transitions. Closing A must not leave an input guard that revives its closed bridge, interferes with B, or throws on later input.

## Passive diagnostic capture

Use two isolated fresh consoles with Send Context 2.9.0 or newer. Test the global `diagnostics` setting through `omp plugin config set omp-send-context diagnostics true`, with the QA HOME selected for that command as well as the consoles. Do not enable it in the maintainer's personal fleet as incidental QA.

1. Start with diagnostics off: no capture directory should be created. Select B, then enable diagnostics globally. Both consoles should create distinct private capture files; B must remain selected without any new input or focus-mode output from diagnostics.
2. Leave both consoles idle across multiple snapshot intervals. No terminal query or generated input should appear. Deliver a unique harmless marker through the real producer and verify only B's prompt contains it. Neither that marker nor the bridge bearer token may appear in any capture file.
3. Disable globally and wait for queued writes to settle. Capture files must stop changing while normal focus and delivery continue working. Re-enable without restarting; both consoles must resume capture. Repeat with autofocus disabled and with a per-process autofocus flag.
4. Exercise a session transition, later focus-out, and an independent restart. Verify diagnostics does not become a new routing/recovery path, and new consoles inherit the setting. `/ide diagnostics` and its autocomplete should show state/path without creating a missing bridge; run this after focus-only assertions because command entry itself is activity.
5. Close the QA consoles and observe final events and settled files. Run logger regressions for privacy, bounded rotation, write failure, concurrent toggles, and independent registration files; integration regressions must cover a diagnostics-only toggle with a lost subscription so a hidden rebind cannot pass.

Record diagnostic behavior separately from routing reliability. A healthy capture or successful delivery during this scenario does not resolve an intermittent failure that has not been reproduced.

## Evidence and cleanup

Record the loaded artifact/version, OMP and wrapper versions, cancellation ordering, input source (physical focus or injected PTY), native/HTTP result when applicable, and the observed destination prompt in the owning evidence record. A successful command notification or pointer update alone is not delivery proof. Run the focused behavioral regressions with `node --test test/omp/*.test.mjs`, then the documented `npm test` gate.

Stop only QA-owned processes and remove the temporary cancellation extension and isolated state. Preserve ordinary user consoles. A user-reported recurrence remains evidence even when one reproduced cause passes; distinguish unobserved terminal/multiplexer forwarding from verified OMP subscription behavior.
