# Release workflow

Use this workflow when a change needs a published artifact. A documentation-only change is released through its reviewed, merged pull request: run the documentation formatting and Markdown link checks, but do not bump the package version or publish runtime artifacts solely for documentation.

User-facing changes follow the issue/branch/linked-PR/review workflow in [development](development.md). Confirm acceptance criteria, relevant tests, and review feedback are resolved before merging. Release approval and publication are separate steps; never claim publication or installation without observing it.

## Choose the artifact

This repository has separately distributed integrations. Release only the artifact changed by the accepted work:

- VS Code-compatible clients receive the Marketplace extension.
- The OMP plugin is installed from this GitHub repository and includes the bridge runtime. A runtime release must be exercised from the published GitHub source, not only from a linked checkout.
- Firefox publishing and artifact-specific checks are covered by the [Firefox publishing workflow](firefox-publishing.md).

Do not publish an unchanged integration as a side effect of releasing another one.

## VS Code Marketplace

The root `package.json` is the Marketplace package manifest. Its `publish:marketplace` script invokes `vsce publish`, and `vscode:prepublish` runs the package build. The package build performs the TypeScript check and bundles `dist/extension.cjs`.

Before publishing, run the project checks and prepare the VSIX:

```bash
npm test
npm run package:vsix
```

After the change is merged, update the package version and changelog as appropriate, then publish:

```bash
npm version minor --no-git-tag-version
npm run publish:marketplace
```

Choose the correct semantic version increment for the change rather than copying `minor` mechanically. Authenticate `vsce` with the `klondikemarlen` publisher account (`npx vsce login klondikemarlen`) or use the configured `VSCE_PAT` in non-interactive publishing. The PAT requires Marketplace → Manage scope; do not put credentials in repository files.

Observe Marketplace availability before calling the release complete. The repository's prior procedure queried `npx vsce show klondikemarlen.omp-send-context --json` until the new version appeared; confirm the listing links to this GitHub repository and that the repository metadata links back to the listing. Then install from the remote Marketplace and verify the installed version in the target client.

## OMP plugin runtime

For a runtime change, uninstall the installed package with `omp plugin uninstall omp-send-context`, then install the released GitHub source with `omp plugin install github:klondikemarlen/omp-send-context`. Verify what users actually install rather than testing only `omp plugin link`.

After the remote install, start a **fresh OMP process** and run `/ide status` to confirm the loaded plugin version and bridge endpoint. Existing OMP processes keep extension modules loaded from startup; a plugin reload alone is not sufficient evidence that the newly installed artifact is active. Exercise the changed behavior and `/ide status` argument autocomplete in that fresh process before describing the release as installed or working.

The OMP package release and Marketplace VS Code release are distinct observations. Verify each changed artifact from its actual distribution channel; do not infer that publishing one publishes the other.

## Firefox artifact

Follow the dedicated [Firefox publishing workflow](firefox-publishing.md), which covers its build/sign/distribution-specific release steps and evidence. Do not substitute Marketplace or OMP install evidence for Firefox artifact verification.

## Documentation-only pull requests

Documentation changes still receive a reviewed PR and must pass formatting and relative-link/heading-anchor checks. Update the changelog for the documentation change without implying a new runtime version. A documentation-path change may require updating the package file allowlist; check that linked documents are included. Do not publish runtime artifacts solely for documentation.
