# Changelog

## 1.8.9

- Submit the refreshed Firefox toolbar artwork and compact popup controls for public AMO review.

## 1.8.8

- Prepare the refreshed Firefox toolbar artwork and compact popup controls as a signed unlisted AMO validation artifact.

## 1.8.7

- Refresh Firefox toolbar artwork with the OMP send-context terminal mark.
- Redesign the Firefox popup around the dark technical-minimal visual system with compact delivery, context, and debug controls.
- Add focused coverage for the popup's branded surface, version display, and debug-state controls.

## 1.8.6

- Promote the Firefox add-on to supported release status.
- Update AMO listing metadata to mark the add-on as a supported release.

## 1.8.5

- Publish the prompt-boundary fix after AMO reserved 1.8.4 for unlisted validation.

## 1.8.4

- Terminate Firefox handoff prompts with a blank line so follow-up comments stay outside the selected-text fence.

## 1.8.3

- Keep Firefox debug state and diagnostic entries in memory for the current browser session only.
- Remove persistent GitHub page access and static page injection; capture uses click-time `activeTab` access on eligible HTTP(S) pages.
- Refresh the normal and debug toolbar artwork.


## 1.8.2

- Prepare the listed AMO review submission after the signed unlisted 1.8.1 validation build.

## 1.8.1

- Add the GitHub repository as the Firefox add-on homepage for AMO submissions.

## 1.8.0

- Capture selected text, page URL, and document title from ordinary HTTP(S) pages while retaining GitHub pull-request metadata.
- Use click-time `activeTab` injection for generic shortcut capture without adding permanent access to every website.

## 2.0.1

- Enable Linux terminal focus routing by default while preserving explicit opt-out and non-Linux behavior.

## 2.0.0

- Cut over the VS Code Marketplace and OMP plugin identities to `omp-send-context`.


## 1.7.7

- Fix Firefox native-delivery fallback to verify clipboard writes and report failure instead of claiming success.
- Register a launcher with the installer so Snap/Flatpak Firefox can start the native host outside the interactive shell environment.

## 1.7.6

- Add a Linux Firefox native-host installer with an explicit `xdg-native-messaging-proxy` check for Snap and Flatpak Firefox.

## 1.7.4

- Document the one-time OMP plugin migration required after the repository rename.

## 1.7.3

- Align the README branding with the `omp-send-context` repository name.

## 1.7.2

- Rename the repository to `omp-send-context` and preserve compatibility-sensitive VS Code and OMP package identifiers.

## 1.7.1

- Add Selenium WebDriver as a development dependency and document Firefox manual QA and AMO publishing workflows.

## 1.7.0

- Add a source-agnostic protocol-v1 envelope for context clients.
- Add a Firefox GitHub pull-request client with permalink metadata and clipboard fallback.
- Add a secure native-messaging host for direct Firefox-to-OMP delivery.

## 1.6.10

- Isolate the bridge runtime from OMP event registration.

## 1.6.9

- Group the bridge status command under `/ide status`.

## 1.6.8

- Apply the Linux terminal-focus setting immediately to running OMP sessions.

## 1.6.7

- Add opt-in Linux terminal-focus routing so VS Code context follows the OMP terminal that reports xterm focus.

## 1.6.6

- Add an OMP-side cosmetic paste separator so typing after a context paste does not run into the paste badge.

## 1.6.5

- End handoff packets with an edit-friendly blank line and move the endpoint override into advanced settings.

## 1.6.4

- Make the bounded agent handoff packet the default `Ctrl+Alt+K` mode, with minimal token fallbacks still available through settings.

## 1.6.3

- Remove low-value handoff packet settings and omit visible editor references from handoff output.

## 1.6.2

- Prioritize `ompContext.insertMode` in VS Code settings and mark handoff-only tuning settings as advanced.

## 1.6.1

- Add `ompContext.insertMode` so `Ctrl+Alt+K` can opt into handoff packets, and quiet handoff output by omitting empty sections and duplicate active-editor references.

## 1.6.0

- Add the `OMP Context: Insert Agent Handoff Packet` command for bounded Markdown handoffs with active editor context, workspace root, visible editor references, capped diagnostics, byte caps, and clipboard fallback.

## 1.5.1

- Document the Devin Desktop CLI as a Marketplace install fallback when `code` is unavailable.

## 1.5.0

- Clarify that inline mode is stale-safe because it sends both the file reference and exact selected text.

## 1.4.0

- Document OMP 16.3.7+ as the supported runtime floor and remove the older prompt repaint workaround from the bridge.

## 1.3.3

- Make inline context the default so selected text is pasted with the file reference; keep reference mode as the compact optimization.

## 1.3.2

- Remove the redundant `ompContext.delivery` setting and hidden non-paste bridge delivery paths.

## 1.3.1

- Remove the `selection` content mode to keep context formatting settings focused on reference and inline modes.
- Document the post-publish Marketplace polling and reinstall verification step.

## 1.3.0

- Add `selection` content mode for sending only selected text as a fenced code block.
- Document the issue-to-merge feature workflow.

## 1.2.2

- Improve the prompt repaint workaround for older OMP builds.

## 1.2.1

- Wait for delayed OMP prompt paste state before forcing repaint.

## 1.2.0

- Rename OMP routing commands to `/ide` and `/ide-status`.
- Preserve the active live bridge when multiple OMP terminals are open.
- Force prompt repaint after VS Code context paste so inserted text is visible immediately.

## 1.0.1

- Refresh OMP prompt rendering after VS Code context paste.
- Send only the delivery mode and prompt text over the bridge.

## 1.0.0

- Remove the leading `In` from inserted context references.
- Reduce routine success notifications from VS Code and the OMP bridge.

## 0.1.6

- Update VS Code and OMP install instructions; re-running `omp plugin install` now refreshes existing GitHub plugins.

## 0.1.5

- Clarify normal OMP plugin install and update commands.
- Document local development linking with `omp plugin link`.

## 0.1.4

- Include character positions in file references.
- Add a trailing space after inserted references for continued typing.

## 0.1.3

- Add OMP commands for routing VS Code context to a chosen terminal.
- Document GitHub plugin updates through Bun's plugin lockfile.
- Include the plugin version in the OMP bridge state and status command.

## 0.1.2

- Improve Marketplace metadata and README install instructions.
- Document Marketplace, publisher hub, and GitHub links.

## 0.1.1

- Default selected code to file references instead of inline code blocks.
- Add `ompContext.contentMode` for opting back into inline selected text.

## 0.1.0

- Publish the initial VS Code command for sending active editor context to OMP.
- Include the companion OMP loopback bridge extension for prompt insertion.
- Document the bridge concepts, data contract, security model, and delivery modes.
