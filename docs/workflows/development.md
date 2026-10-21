# Development workflow

This workflow is for contributors changing the VS Code client, OMP bridge, Firefox client, GNOME Shell companion, or shared protocol. Product intent belongs in the [product docs](../product/editor.md); architecture contracts are described in the [context bridge overview](../architecture/context-bridge.md). Source and tests remain authoritative for current behavior.

## Checkout and repository map

From a checkout of this repository:

```bash
npm ci
```

Main areas:

- `vscode/` — VS Code extension source and prompt construction.
- `firefox/` — Firefox add-on, native messaging host, and Firefox build/install scripts.
- `omp/` — OMP bridge runtime and plugin entry point.
- `protocol/` — versioned envelope schema and example.
- `test/` — tests grouped around integrations and protocol.
- `gnome-shell/` — native GJS extension for GNOME Shell and its local OMP bridge handoff.

The root `package.json` owns the shared scripts and development dependencies. The Firefox package has its own scripts for Firefox-specific artifacts and host operations.

## Local OMP and VS Code development

Link the checkout as an OMP plugin and build the VS Code extension package:

```bash
npm run package:vsix
omp plugin link "$PWD"
```

Install the generated VSIX in the editor under development. The package command writes to `/tmp/omp-send-context-<version>.vsix`, outside the checkout. Restart OMP after source edits; on OMP 18.11.1, `/reload-plugins` refreshes resources and MCP state, not the loaded extension module. VS Code extension edits require rebuilding and reinstalling the VSIX, then reloading the editor window. An already-running OMP process or editor window retains its loaded extension code.

For an installed product rather than a linked checkout, follow the [user installation instructions](../product/editor.md).

## Firefox development

Firefox-specific packaging, temporary installation, native-host setup, and manual QA are documented separately:

- [Firefox QA scenarios](../qa-scenarios/firefox.md)
- [Firefox publishing workflow](firefox-publishing.md)

Keep Firefox-only tooling and installation details with those workflows rather than duplicating the complete procedure here.

## GNOME Shell development

The extension runs in GJS and uses GNOME's GObject Introspection bindings, not Node or browser APIs. A Node test double is not evidence that the Shell runtime supports an API: GJS 1.88, for example, has no global `URL`. Use native APIs such as `GLib.Uri` for GJS code and exercise the consumer under GJS.

The native GNOME scenarios in `test/gnome-shell/*.test.mjs` are part of the general Node suite, but their suites skip when `gjs` is unavailable. A green `npm test` with those skips does not establish native-runtime coverage. The `GNOME native bridge` Quality job installs GJS and Soup bindings and runs `npm run test:gnome-native`, which requires GJS before running the bridge and capture-lifecycle scenarios.

`npm run test:gnome` fails immediately if GJS is missing, executes the native bridge regressions, packages the extension, checks that the ZIP excludes `schemas/gschemas.compiled`, and verifies `ACTIVE` in a disposable headless GNOME Shell. It also needs the GNOME Shell test tool and D-Bus session support. This is broader packaging/activation evidence, but it still does not prove delivery from a focused desktop Ptyxis window. Follow the [GNOME Shell QA guide](/docs/qa-scenarios/gnome-shell.md) for that separate surface.

## Checks

Use the Node version in `.tool-versions`, install with `npm ci`, and run `npm test`. The command checks formatting and TypeScript, then invokes `bin/test`: a finite wrapper around Node's native test runner with a separate process per test file. JavaScript and TypeScript scenarios can change process-local HOME/platform/stdout without leaking those changes into another file. Do not replace this isolation with a dynamic-import collector.

`npm test` supports dirty development checkouts. Release signing still requires clean source provenance; ordinary tests must not invoke a signing command against the contributor's checkout merely to assert forwarded arguments. Use isolated fixtures for clean/dirty source behavior and real artifact assertions for packaged provenance.

`npm run test:typescript` (or `./bin/test --typescript`) runs only the TypeScript tests through the actual `tsx` loader. `.marlens-verifications.json` points the installed TypeScript runtime verifier at this tracked executable; it is a runtime check, not a substitute for `npm run check-types`. The compiler configuration checks editor TypeScript and TypeScript tests, not all JavaScript or the Go host. See [runtime and language boundaries](/docs/architecture/context-bridge.md#runtime-and-language-boundaries).

Run `npm run test:firefox-native-host` for the Go implementation with Go installed. The `Quality` GitHub Actions workflow runs the Node and native-host commands as separate jobs for every pull request and push to `main`; it has no path filters. Node comes from `.tool-versions`, and the native-host job uses the current stable Go toolchain.

The package scripts also include `check-format`, `check-types`, `package`, and `package:vsix`; `vscode:prepublish` invokes the production package build. Test-authoring conventions live beside the tests in [`test/README.md`](https://github.com/klondikemarlen/omp-send-context/blob/main/test/README.md).

Focus lifecycle regressions must include loss of the input subscription with **neither** session hook delivered, not only successful switches or cancellation after this plugin's hook runs. Model Node stdin dispatch before OMP input listeners so a repair that happens too late cannot pass. Follow the [focus lifecycle QA](/docs/qa-scenarios/omp-focus.md) for real-runtime delivery evidence; keep the temporary cancellation harness out of the shipped package.

For documentation-only changes, run `npm run check-format`, `git diff --check`, and verify relative Markdown paths and heading anchors from their new locations. When moving packaged documents, also inspect `npm pack --dry-run --json` for the linked pages. These checks do not require installing or publishing a runtime artifact.

## Change and review procedure

For user-facing changes, create an issue with user story, acceptance criteria, and learner-coverage outcome; work on an issue-named branch; and open a linked pull request. Review the diff and relevant tests, resolve review feedback, and merge only when required checks pass. Follow the [release workflow](release.md) only when the change requires a published artifact; documentation-only changes need a reviewed PR, not a package version bump or publication.
