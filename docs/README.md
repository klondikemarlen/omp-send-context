# Project Knowledge Base

Start with the [project README](../README.md) to install a released client and send your first selection. This index is the home for deeper product and contributor knowledge.

## Use the product

- [Editor context](product/editor.md): VS Code and Devin Desktop installation, packet settings, updates, and OMP console selection.
- [Firefox context](product/firefox.md): supported pages, native-host installation, sandbox registration, clipboard fallback, and privacy.
- [Troubleshooting](product/troubleshooting.md): delivery failures, stale installs, and selecting the right console.

## Understand the system

- [Context bridge architecture](architecture/context-bridge.md): ownership, envelope contract, discovery, authentication, and prompt insertion.
- [Design system](references/design-system.md): visual design intent for the client surfaces.

## Develop and release

- [Local development](workflows/development.md): repository ownership, checkout setup, isolated Node/TypeScript checks, native-host verification, and test-authoring guidance.
- [Release workflow](workflows/release.md): issue/PR discipline, Marketplace publishing, and fresh-process installation checks.
- [Firefox publishing](workflows/firefox-publishing.md): AMO signing, native-host PPA packaging, and observed post-publish verification.

## Verify behavior

- [Firefox QA scenarios](qa-scenarios/firefox.md): fresh-profile, selection, metadata, native delivery, fallback, and multiple-session checks.
- [OMP focus lifecycle QA](/docs/qa-scenarios/omp-focus.md): successful and cancelled session changes, hook ordering, multi-console delivery, opt-out, and reload cleanup.
- [GNOME Shell companion QA (unreleased development only)](/docs/qa-scenarios/gnome-shell.md): native GJS checks, exact-ZIP desktop acceptance, and separate-session boundaries; this is not a supported installation guide.

## Authority and enrichment

Product guides describe intended user behavior and supported installation paths. Source code defines current implementation behavior; tests and recorded QA results provide evidence, not a blanket claim that every configuration was exercised. Architecture captures boundaries and invariants; workflows describe contributor actions; references retain design intent.

When learning something durable, update the page that owns it and link its evidence. Keep user-facing behavior in product guides, implementation boundaries in architecture, repeatable validation in QA scenarios, and contributor procedures in workflows. Do not duplicate an entire procedure across the README and detailed pages. Record a source conflict explicitly rather than silently turning an inference into a product promise.

Unreleased component guidance belongs beside its source and is excluded from this core navigation. Historical changelog entries are not installation or release-status guidance.

## Publication boundary

This is a public repository: every committed document is public, including source-local notes. Navigation does not provide confidentiality; never commit credentials or private account/session material.

No documentation site is configured here. Any future site must select public-facing inputs explicitly with an allowlist or audience metadata rather than publishing every Markdown file by default. Source-local work-in-progress material must not be promoted into released product guidance without a release decision.
