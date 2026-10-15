# Behavioral Tests

Use the repository's `node:test` and `node:assert/strict` conventions. Commands and runtime coverage are documented in [development checks](/docs/workflows/development.md#checks).

## Scenarios and Assertions

- Name changed scenarios `when [condition], [behavior]` so the failure states both the trigger and expected outcome.
- Mark the actual setup, user action, and outcome with ordered `// Arrange`, `// Act`, and `// Assert` comments. Keep scenario-specific asynchronous setup inside the callback that owns the behavior; do not hide actions in a broad shared hook.
- Assert observable returned values, state transitions, delivery destinations, protocol errors, and at-most-once behavior. HTTP status and resulting prompt text can jointly prove one delivery outcome; do not split a coupled invariant merely to count assertions.
- Do not pin implementation source, CSS literals, incidental UI copy, mock argument forwarding, or copies of catalog defaults. Delete such checks rather than updating their strings. Generated artifact identity and provenance are output contracts, not incidental implementation text.
- Preserve local, explicit scenario inputs. Shared helpers may own stable temporary HOME/state/server setup, but must not hide varying actions or expected outcomes.

## Isolation and Cleanup

`bin/test` uses native Node per-file process isolation. Within a file, still restore process globals and dispose real servers, listeners, timers, subprocesses, and temporary directories. Do not rely on another test's cleanup or mutate the contributor's actual configuration.

Clean/dirty Git provenance checks belong in temporary repositories. Release signing must retain its production clean-source restriction; ordinary test runs must work in a dirty development checkout without making external signing requests.

The shared test-alignment verifier checks changed files against its naming/phase baseline. Run it over the PR's changed test paths, not an empty post-commit worktree diff. Passing that style check is not behavioral proof: also execute the scenario and the documented suite.
