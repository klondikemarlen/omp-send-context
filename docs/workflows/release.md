# Release workflow

Use this workflow when a change needs a published artifact or a refreshed public listing. Repository-only documentation, tests, CI, or development-tooling changes that leave shipped runtime behavior unchanged are delivered through their reviewed, merged pull request without a package release. The Marketplace description is different: it is embedded from `README.md` into the published VSIX, so updating the live description requires a new Marketplace version.

User-facing changes follow the issue/branch/linked-PR/review workflow in [development](development.md). Confirm acceptance criteria, relevant tests, and review feedback are resolved before merging. Release approval and publication are separate steps; never claim publication or installation without observing it.

## Choose the artifact

This repository has separately distributed integrations. Release only the artifact changed by the accepted work:

- VS Code-compatible clients receive the Marketplace extension.
- The OMP plugin is installed from this GitHub repository and includes the bridge runtime. A runtime release must be exercised from the published GitHub source, not only from a linked checkout.
- Firefox publishing and artifact-specific checks are covered by the [Firefox publishing workflow](firefox-publishing.md).
- GNOME Shell users receive the approved companion from GNOME Extensions; future submissions use the approval gate below.

Do not publish an unchanged integration as a side effect of releasing another one.

## GNOME Shell companion

The Ptyxis-only companion is distributed through [GNOME Extensions](https://extensions.gnome.org/extension/10625/omp-send-context/). Version 8 was approved for GNOME Shell 50 on October 21, 2026; its [review record](https://extensions.gnome.org/review/76899) establishes approval, not just upload acceptance. Released installation and selection limits belong in the [product guide](/docs/product/gnome-shell.md).

**Future uploads remain paused.** `upload-gnome.mjs` remains deliberately disabled and stops before prompting for upload credentials or making network requests. Approval of an existing version does not authorize another upload. Do not remove or bypass that safeguard as part of local QA or another integration's release.

GNOME rejected version 7 because its ZIP included `schemas/gschemas.compiled`. Every future candidate must exclude that file; a prior public listing is not evidence that a changed ZIP is ready. Follow the [GNOME Shell QA guide](/docs/qa-scenarios/gnome-shell.md) and review the exact candidate ZIP that received desktop acceptance.

Before any GNOME upload is enabled or attempted, show the maintainer:

1. A per-file diff between the exact candidate ZIP and the currently active submitted ZIP, explaining how each changed file affects user-visible behavior.
2. Evidence for native GJS parsing and delivery, package/headless activation, fresh-session desktop delivery using that exact ZIP, and every `shexli` finding with its disposition.
3. Relevant GNOME reviewer feedback, including the prior compiled-schema rejection and how the candidate addresses it.

Only after this explanation, obtain the maintainer's explicit confirmation in the current conversation before any upload. A generic request to publish or release is not approval for a GNOME submission. Restore the uploader pause immediately after the authorized submission. Verify upload acceptance, external GNOME review, and active public listing separately for each new version; approval of version 8 does not establish any future candidate's status.

## VS Code Marketplace

The root `package.json` is the Marketplace package manifest. Its `publish:marketplace` script invokes `vsce publish`, and `vscode:prepublish` runs the package build. The package build performs the TypeScript check and bundles `dist/extension.cjs`.

For an explicitly requested Marketplace documentation refresh, use the smallest appropriate version increment, package the reduced README, and follow the same checks, publishing, live read-back, and remote-install verification as other Marketplace releases. Confirm relative documentation links are rewritten to existing repository pages; a repository README merge alone does not update the published description.

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

For focus or session-lifecycle changes, run the [focus lifecycle QA](/docs/qa-scenarios/omp-focus.md) against that installed artifact. Cover successful `/new` and cancellation by an extension loaded both before and after Send Context. Prove focus-only recovery and delivery **before** typing `/ide` or another command in the affected console; manual repair or command-entry activity can hide a broken subscription. Include last-active multi-console delivery, later focus-out non-stealing, explicit opt-out, and reload cleanup. Record the OMP version and whether input came from physical focus or injected PTY reports; never infer compositor/multiplexer forwarding from a PTY result.

Before uninstalling, record only this plugin's autofocus preference and restore it after installation if uninstall removes it. Do not dump the full plugin lock file or credentials into release evidence.

The OMP package release and Marketplace VS Code release are distinct observations. Verify each changed artifact from its actual distribution channel; do not infer that publishing one publishes the other.

## Firefox artifact

Follow the dedicated [Firefox publishing workflow](firefox-publishing.md), which covers its build/sign/distribution-specific release steps and evidence. Do not substitute Marketplace or OMP install evidence for Firefox artifact verification.

## Repository-only pull requests

Documentation and tooling changes still receive a reviewed PR. Require current-head `Quality` CI results for Node and the Go native host, scoped whitespace checks, and relative-link/heading-anchor checks for changed docs. Exercise changed developer commands directly, including failure propagation and process isolation when the test wrapper changes. A local check that cannot run is `BLOCKED` for that surface, not proof that another language's tests cover it.

Update the changelog without implying a new runtime version unless a distributed artifact actually changes. A documentation-path change may require updating the package file allowlist; inspect the package contents for linked pages. For a requested public-listing refresh, verify each distribution surface independently. AMO supports metadata-only edits; do not upload an unchanged Firefox artifact or publish unrelated integrations.
