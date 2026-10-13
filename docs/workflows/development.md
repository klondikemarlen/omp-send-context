# Development workflow

This workflow is for contributors changing the VS Code client, OMP bridge, Firefox client, or shared protocol. Product intent belongs in the [product docs](../product/editor.md); architecture contracts are described in the [context bridge overview](../architecture/context-bridge.md). Source and tests remain authoritative for current behavior.

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

The root `package.json` owns the shared scripts and development dependencies. The Firefox package has its own scripts for Firefox-specific artifacts and host operations.

## Local OMP and VS Code development

Link the checkout as an OMP plugin and build the VS Code extension package:

```bash
npm run package:vsix
omp plugin link "$PWD"
```

Install the generated VSIX in the editor under development. The package command writes to `/tmp/omp-send-context-<version>.vsix`, outside the checkout. OMP source edits take effect after restarting OMP or running `/reload-plugins`; VS Code extension edits require rebuilding and reinstalling the VSIX, then reloading the editor window. An already-running OMP process or editor window retains its loaded extension code.

For an installed product rather than a linked checkout, follow the [user installation instructions](../product/editor.md).

## Firefox development

Firefox-specific packaging, temporary installation, native-host setup, and manual QA are documented separately:

- [Firefox QA scenarios](../qa-scenarios/firefox.md)
- [Firefox publishing workflow](firefox-publishing.md)

Keep Firefox-only tooling and installation details with those workflows rather than duplicating the complete procedure here.

## Checks

The root `npm test` script runs formatting check, TypeScript type-checking, and the Node test suite. Run focused tests for a behavior change during development, then run the documented full checks before proposing the change. The package scripts include `check-format`, `check-types`, `package`, and `package:vsix`; `vscode:prepublish` invokes the production package build.

For documentation-only changes, run `npm run check-format`, `git diff --check`, and verify relative Markdown paths and heading anchors from their new locations. When moving packaged documents, also inspect `npm pack --dry-run --json` for the linked pages. These checks do not require installing or publishing a runtime artifact.

## Change and review procedure

For user-facing changes, create an issue with user story, acceptance criteria, and learner-coverage outcome; work on an issue-named branch; and open a linked pull request. Review the diff and relevant tests, resolve review feedback, and merge only when required checks pass. Follow the [release workflow](release.md) only when the change requires a published artifact; documentation-only changes need a reviewed PR, not a package version bump or publication.
