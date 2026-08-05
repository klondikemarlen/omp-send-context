# OMP Send Context

VS Code client plus OMP extension for sending source selections to OMP with `Ctrl+Alt+K`; a Firefox client is also available under `firefox/`. It sends context only when you explicitly invoke `Ctrl+Alt+K` or the **Send selection and link to OMP** context-menu command; it never sends page data automatically.

## Repository layout

- `vscode/` — VS Code extension source (`extension.ts`, `prompt.ts`).
- `firefox/` — Firefox add-on, native host, and Firefox-only build/sign/install scripts.
- `omp/` — OMP bridge runtime and extension entry point.
- `gnome-shell/` — GNOME Shell companion extension for focused Ptyxis selections.
- `protocol/` — versioned context-envelope schema and example fixtures shared by clients and runtimes.
- `test/<integration>/` — tests grouped by integration (`vscode`, `firefox`, `omp`, and `protocol`).

## What it does

Press `Ctrl+Alt+K` on Linux/Windows or `Cmd+Alt+K` on macOS while a VS Code editor is focused.

By default, OMP receives a bounded agent handoff packet with the active editor context and workspace root. VS Code diagnostics are omitted by default; enable `ompContext.handoffIncludeDiagnostics` when you want them included:

````text
# OMP Agent Handoff

## Active editor

@src/example.ts#L7C17-L9C20

```typescript
const value = 1
return value
```

## Workspace

- Root: `/path/to/workspace`
````

The default inline content mode is stale-safe for ordinary selections: it includes the reference plus selected text as a fenced code block, so OMP receives the exact bytes you selected unless the bounded handoff packet reaches `ompContext.handoffMaxBytes`. Set `ompContext.contentMode` to `reference` to send only `@file#LxCy-LxCy` when you prefer the smaller file-reference optimization.

If the OMP bridge is not reachable, the VS Code extension copies the same context block to the clipboard.

Set `ompContext.insertMode` to `editorContext` when you want `Ctrl+Alt+K` / `Cmd+Alt+K` to send only the active file reference and selected text.

## Install

You need both pieces:

1. The VS Code extension captures editor state.
2. The OMP extension receives the context and inserts it into the OMP prompt.

### VS Code-Compatible Marketplace Clients

Install or update from Marketplace. This project uses **Devin Desktop**, a VS Code-based desktop client; it supports the same Marketplace extension format and its own `devin-desktop` CLI:

```bash
devin-desktop --install-extension klondikemarlen.omp-send-context --force
devin-desktop --list-extensions --show-versions | grep '^klondikemarlen.omp-send-context@'
```

Plain VS Code uses:

```bash
code --install-extension klondikemarlen.omp-send-context --force
```

Or use the client's Extensions view and search for **Oh My Pi Send Context**. Marketplace installs normally auto-update unless extension auto-update is disabled.

Links:

- Marketplace: https://marketplace.visualstudio.com/items?itemName=klondikemarlen.omp-send-context
- Marketplace publisher hub: https://marketplace.visualstudio.com/manage/publishers/klondikemarlen
- GitHub: https://github.com/klondikemarlen/omp-send-context

If this project helps you, you can optionally support maintenance with a [Ko-fi tip](https://ko-fi.com/klondikemarlen).

### OMP plugin

Install the companion OMP extension from GitHub:

```bash
omp plugin install github:klondikemarlen/omp-send-context
```

If the old `omp-vscode-context` package is already installed, remove it once before installing from the renamed repository to avoid a package-name resolution loop:

```bash
omp plugin uninstall omp-vscode-context
omp plugin install github:klondikemarlen/omp-send-context
```

`omp install github:klondikemarlen/omp-send-context` also works; `omp plugin install` is clearer because this is an OMP plugin, not the VS Code extension.

Update an already-installed GitHub plugin with the same command:

```bash
omp plugin install github:klondikemarlen/omp-send-context
```

Then restart OMP or run `/reload-plugins`.

Supported OMP runtime: `16.3.7` or newer. That release includes upstream OMP [can1357/oh-my-pi#4342](https://github.com/can1357/oh-my-pi/pull/4342), which repaints the prompt after extension `pasteToEditor` / `setEditorText` mutations; older runtimes may still load the plugin but are outside this repo's support floor.

This plugin is installed from the GitHub repo because it ships an OMP runtime extension, while the VS Code half is installed from Marketplace.

### Firefox client

The Firefox client is a WebExtension with opt-in, session-only diagnostic logging. Debug output is limited to bounded stage and error codes to help diagnose delivery failures.

The Firefox client is a separate WebExtension under `firefox/`. On ordinary `http://` and `https://` pages, its **Send selection and link to OMP** context-menu action and configurable `Ctrl+Alt+K` shortcut send the current selected text, page URL, and document title. The add-on requests persistent access only to ordinary HTTP(S) pages so the shortcut works without a prior toolbar click; it does not request access to local files. Firefox-protected pages, including AMO, Firefox internal pages, `file:` pages, empty selections, and other unsupported inputs are rejected without delivery.

GitHub pull-request pages keep the richer behavior: the same menu action and shortcut preserve the GitHub title, selected-link/permalink metadata, and `## GitHub` prompt section. Selections from a PR diff add human-readable Git metadata: `File`, `Version` (`original` or `modified`), `Change` (`added`, `removed`, `context`, or `mixed`), selected `Lines`, and an explicit `Head commit` only when the page exposes a head-specific SHA. `Location` remains an optional exact GitHub diff permalink; its UI-specific diff anchor is never treated as a commit. Generic pages use `## Web page` and always retain the page URL.

For normal distribution, install the signed add-on from its [AMO listing](https://addons.mozilla.org/en-CA/firefox/addon/omp-send-context/). Maintainers can manage submissions from the [AMO developer page](https://addons.mozilla.org/en-CA/developers/addon/omp-send-context/edit). The OMP plugin and the Firefox add-on are separate installs; installing the add-on does not install the native-messaging host.

For local development, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `firefox/manifest.json`. Temporary add-ons are removed when Firefox restarts.

The toolbar button toggles opt-in, session-only debug logging. Debug entries disappear when Firefox restarts. With debug logging enabled, the **Copy OMP Send Context debug log** context-menu action copies bounded stage/error codes only; it never includes selected text, URLs, titles, prompts, bridge state, or bearer tokens. The add-on does not persist page context or collect telemetry.

The client first tries the native-messaging host. If the host is unavailable or rejects delivery, it copies the exact prompt packet to the clipboard; no bridge token is exposed to Firefox.

### Firefox native messaging host (Linux setup)

The Firefox native messaging host is a separately installed local process. Native delivery is optional: when the host is unavailable, the add-on copies the exact context packet to the clipboard. The published PPA package contains a statically linked Go host and does not install the Node.js runtime.

For Ubuntu 26.04 (Resolute), the recommended install is the native host PPA:

```bash
sudo add-apt-repository ppa:klondikemarlen/omp-send-context
sudo apt update
sudo apt install omp-send-context-firefox-host
```

The package installs the host and system Firefox manifest. If Firefox is installed through Snap or Flatpak, also install the sandbox proxy:

```bash
sudo apt install xdg-native-messaging-proxy
omp-send-context-install-firefox-host --sandboxed
```

Run the registration command as your normal desktop user, not with `sudo`. It writes the per-user manifest used by sandboxed Firefox. On other distributions, install the equivalent `xdg-native-messaging-proxy` package when needed.

For source development or distributions without the PPA, install from a checkout. This development path uses the existing Node.js host and therefore requires the documented Node.js prerequisite:

- **System Firefox:** `npm run install:firefox-host`
- **Snap or Flatpak Firefox:** `npm run install:firefox-host -- --sandboxed` after installing `xdg-native-messaging-proxy`

The checkout installer writes an executable launcher at `~/.local/share/omp-send-context/omp_send_context-host` and a per-user manifest at `~/.mozilla/native-messaging-hosts/omp_send_context.json`. The manifest allowlists the extension ID `omp-send-context@klondikemarlen.github.io`. Do not copy the manifest into `~/snap/firefox/` or another sandbox-private directory because the proxy discovers the normal host-manifest location. Review the [proxy security warning](https://github.com/flatpak/xdg-native-messaging-proxy#readme) before enabling it.

After installation, start a fresh OMP process and restart Firefox. Invoke `Ctrl+Alt+K` on any eligible HTTP(S) page, including GitHub pull requests. With debug logging enabled, native delivery passes when the log contains `native:succeeded`; clipboard fallback is expected only when the host is unavailable.

The native host intentionally accepts only `http://127.0.0.1:<port>` bridge endpoints and never logs prompts or bearer tokens.

### GNOME Shell companion for Ptyxis

Ptyxis does not currently expose a supported plugin ABI. The repository therefore ships a GNOME Shell companion extension that reads the focused Ptyxis window's PRIMARY selection and sends it through the active OMP bridge; it does not patch or inject into Ptyxis.

On GNOME Shell 50, build and install the extension from a checkout:

```bash
npm run package:gnome
gnome-extensions install --force /tmp/omp-send-context-gnome/omp-send-context-gnome@klondikemarlen.github.io.shell-extension.zip
gnome-extensions enable omp-send-context-gnome@klondikemarlen.github.io
```

`gnome-extensions install` writes the ZIP to the user extension directory but does not load a new UUID into the already-running Shell; GNOME Shell discovers it at session startup. Start a fresh GNOME Shell session after installing, then start a fresh OMP process, select text in Ptyxis, and use a user-configured shortcut. The extension sends only the current PRIMARY selection and reports no-selection, unsupported-focus, and bridge errors visibly. The schema intentionally has no default clipboard shortcut because GNOME review guidelines prohibit shipping default keyboard shortcuts for clipboard access. GNOME Shell's supported keybinding API owns a registered accelerator at the compositor layer; it does not provide a supported consume-and-re-send operation. Configure `Ctrl+Shift+Alt+X` with the schema-aware command below; it stays distinct from Firefox and VS Code's `Ctrl+Alt+K`.

This companion is separate from the Firefox integration and does not change Firefox behavior.

#### GNOME companion maintenance and review

The companion is packaged separately from the VS Code, OMP, and Firefox artifacts:

```bash
npm test
npm run package:gnome
unzip -l /tmp/omp-send-context-gnome/omp-send-context-gnome@klondikemarlen.github.io.shell-extension.zip
```

Run the GNOME static analyzer from the repository's asdf Python:

```bash
python -m pip install -U shexli
shexli "$PWD/gnome-shell"
shexli "/tmp/omp-send-context-gnome/omp-send-context-gnome@klondikemarlen.github.io.shell-extension.zip"
```

The expected `EGO-A-005 manual_review` finding for `St.Clipboard.get_default()` is intentional: the extension declares PRIMARY clipboard use in its description and only reads it after an explicit user-configured shortcut. Address any other finding before submission.

#### Headless GNOME Extensions upload

`npm run upload:gnome` logs into the GNOME Extensions web form, uploads one ZIP through the documented API, and keeps the returned session cookie in memory only. It uses `secret-tool` (GNOME Keyring/Secret Service) for the account password; it does not read `.envrc`, write a cookie jar, or accept arbitrary upload endpoints.

Do not authenticate the uploader through `/api/v1/accounts/login/`: it validates the credential payload but does not establish the browser session that the upload API requires. The script intentionally follows `/accounts/login/`, carrying that form's CSRF and session cookies only in memory.

One-time desktop setup:

```bash
sudo apt install libsecret-tools
npm run setup:gnome-secrets
```

The setup script asks for your GNOME Extensions login, then `secret-tool` asks for its password. `npm run upload:gnome` asks for the same login when `--account` is omitted. Copy the password from your password manager into the `secret-tool` prompt; it stays in the desktop keyring, not `.envrc` or Git.

```bash
npm test
npm run package:gnome
npm run upload:gnome -- \
  --zip /tmp/omp-send-context-gnome/omp-send-context-gnome@klondikemarlen.github.io.shell-extension.zip \
  --accept-license \
  --accept-terms
```

The command reports success only after the API returns HTTP `201`. That means the upload was accepted for review; it is not publication or reviewer approval.

For another project, copy `upload-gnome.mjs` and add this package script:

```json
"setup:gnome-secrets": "node upload-gnome.mjs --setup",
"upload:gnome": "node upload-gnome.mjs"
```

Install Node from that repository's `.tool-versions` and `libsecret-tools`, then run the copied setup script with that project's name. It prompts for the login and password:

```bash
npm run setup:gnome-secrets -- --project "other-project"
npm run upload:gnome -- --zip dist/gnome/other-extension.zip --project "other-project" --accept-license --accept-terms
```

This desktop flow requires a running unlocked Secret Service and is not a CI credential mechanism. The command holds its authenticated GNOME Extensions session cookie only for the upload and does not use a PAT.

For local testing, install the ZIP with `gnome-extensions install --force`, then log out and back in (or start a fresh GNOME Shell session) before enabling it. A running GNOME Shell does not necessarily rescan newly installed extensions:

```bash
gnome-extensions install --force /tmp/omp-send-context-gnome/omp-send-context-gnome@klondikemarlen.github.io.shell-extension.zip
gnome-extensions enable omp-send-context-gnome@klondikemarlen.github.io
gnome-extensions list | grep omp-send-context
```

The local ZIP keeps its GSettings schema in the extension directory, so configure the opt-in shortcut with that schema path:

```bash
UUID='omp-send-context-gnome@klondikemarlen.github.io'
SCHEMA_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID/schemas"

GSETTINGS_SCHEMA_DIR="$SCHEMA_DIR" \
  gsettings set org.gnome.shell.extensions.omp-send-context \
  desktop-shortcut "['<Control><Shift><Alt>x']"

GSETTINGS_SCHEMA_DIR="$SCHEMA_DIR" \
  gsettings get org.gnome.shell.extensions.omp-send-context desktop-shortcut
```

To remove a checkout install:

```bash
gnome-extensions uninstall omp-send-context-gnome@klondikemarlen.github.io
```

The GNOME Extensions listing is [OMP Send Context](https://extensions.gnome.org/extension/10625/omp-send-context/). Submit new or corrected ZIPs with `npm run upload:gnome`; GNOME review and public listing acceptance remain external. Do not describe a ZIP as published until the listing shows the accepted version.

The extension currently targets GNOME Shell 50 and ships without a default shortcut. Set `desktop-shortcut` explicitly for desktop capture; `Ctrl+Shift+Alt+X` stays distinct from Firefox and VS Code's `Ctrl+Alt+K`. The companion has no supported Ptyxis plugin ABI to depend on and does not provide shortcut pass-through.

For extension errors after a fresh session, inspect the Shell journal:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

The companion requires an active OMP bridge. Start a fresh OMP process after installation and confirm that `~/.omp/agent/editor-context-bridge.json` exists before testing a selected Ptyxis terminal.

Maintenance guides:

- [Firefox manual QA](docs/firefox-manual-qa.md)
- [Firefox publishing](docs/firefox-publishing.md)

### Local development install

For normal use, install from GitHub as shown above. For development on a local checkout, link the local package so OMP loads your working tree instead of a pinned GitHub commit:

```bash
git clone https://github.com/klondikemarlen/omp-send-context.git
cd omp-send-context
npm install
npm run package:vsix
omp plugin link "$PWD"
```

Then restart OMP or run `/reload-plugins`, and install the generated `.vsix` in VS Code. The package command writes it to `/tmp/omp-send-context-<version>.vsix`, keeping generated artifacts out of the checkout. Local edits to `omp/index.js` take effect after `/reload-plugins`; VS Code extension edits still require rebuilding/reinstalling the `.vsix`.

## Multiple OMP terminals

Each OMP terminal runs its own local bridge. The VS Code extension reads `~/.omp/agent/editor-context-bridge.json` and sends `Ctrl+Alt+K` context to the bridge recorded there.

Session start keeps an existing live bridge; session switch claims the current terminal. To explicitly route VS Code context to the terminal you are looking at, run:

```text
/ide
```

To see the active endpoint and plugin version in a terminal, run:

```text
/ide status
```

### Experimental Linux terminal focus routing

On Linux, focus routing is enabled by default. Set **Claim IDE context on focus** to `false` in OMP **Settings → Plugins → omp-send-context** to disable it, or start OMP with `--claim-ide-context-on-focus` to force it on for a process. This setting does nothing outside Linux.

This feature requires OMP `16.5.1` or newer.

Changing this setting starts or stops focus reporting in every running Linux OMP instance; no reload or restart is required. `--claim-ide-context-on-focus` remains a per-process override.

The plugin listens to raw terminal input and enables xterm focus reporting (DECSET 1004). A terminal or transport that forwards a focus-in report (`CSI I`) makes its OMP instance claim the active bridge. Hover is not enough: the terminal must actually receive focus. Other input, including incomplete or non-focus escape sequences, is forwarded unchanged. Unsupported terminals preserve the normal manual route.

When using a terminal multiplexer, configure it to forward xterm focus reports to OMP; otherwise automatic claiming stays inactive and `/ide` remains available.

## Settings

- `ompContext.insertMode`: primary shortcut mode. `agentHandoff` (default) sends the bounded handoff packet; `editorContext` keeps `Ctrl+Alt+K` / `Cmd+Alt+K` on the minimal file/selection prompt.
- `ompContext.contentMode`: selected-text format used by both modes. `inline` (default) includes the reference plus selected text as a fenced code block; `reference` sends only `@file#LxCy-LxCy`.
- `ompContext.handoffIncludeDiagnostics`: include VS Code diagnostics in handoff packets. Default: `false`.
- Advanced settings:
  - `ompContext.endpoint`: optional endpoint override. Empty means read `~/.omp/agent/editor-context-bridge.json`, then fall back to `http://127.0.0.1:47687`.
  - `ompContext.handoffMaxBytes`: maximum bytes inserted by the handoff packet. Default: `20000`.
  - `ompContext.handoffMaxDiagnostics`: maximum VS Code diagnostics included when `ompContext.handoffIncludeDiagnostics` is enabled. Default: `20`.

Use the default `agentHandoff` + `inline` pair for hands-off agent work. Use `editorContext` for a lower-overhead packet shape, `reference` for lower selected-text token use, or both for the smallest file-reference-only fallback. The separate handoff command remains available as a one-off override.

Privacy boundary: the handoff packet is explicit and local, but it may include selected text, local paths, and diagnostics when `ompContext.handoffIncludeDiagnostics` is enabled. Obvious `token=`, `secret=`, `password=`, `apiKey=`, and `authorization=` diagnostic values are redacted; review the inserted prompt before submitting if the workspace contains sensitive data.

## Feature workflow

For user-facing feature work, a request to follow the feature release pattern means completing this whole sequence, not stopping at the pull request:

1. Create a GitHub issue with the user story and acceptance criteria.
2. Create a branch named for the issue.
3. Open a pull request linked to the issue.
4. Review the diff and run the smallest tests that cover the change.
5. Merge only after the PR is reviewed and checks pass.
6. For published changes, merge first, then bump the package version and changelog on `main`.
7. Publish, then poll the Marketplace (`npx vsce show klondikemarlen.omp-send-context --json`) until the new version appears.
8. Reinstall from the remote source and verify the installed version.

## Publish

Marketplace publishing uses `@vscode/vsce`.

Before publishing:

```bash
npm test
npm run package:vsix
```

Publish a new version:

```bash
npm version minor --no-git-tag-version
npm run publish:marketplace
```

`npm run publish:marketplace` runs `vsce publish`, which runs `npm run vscode:prepublish` first. The prepublish step type-checks and bundles `dist/extension.cjs`.

Authentication:

```bash
npx vsce login klondikemarlen
```

Use a Visual Studio Marketplace/Azure DevOps PAT with **Marketplace → Manage** scope. The publisher id is `klondikemarlen`; do not use an email address.

If this machine is already logged in with `vsce`, no `VSCE_PAT` environment variable is needed; `npm run publish:marketplace` uses the stored credentials. Set `VSCE_PAT` only for CI/non-interactive publishing or a machine without `vsce login` state.

After publishing, verify both directions:

- GitHub README links to the Marketplace listing and publisher hub.
- Marketplace listing links back to this GitHub repository through `repository` and `homepage` metadata.

## Concepts

See [CONCEPTS.md](./CONCEPTS.md) for the architecture, data contract, bridge security model, and known limits.

## Security model

- The OMP bridge binds only to `127.0.0.1`.
- OMP writes a random bearer token to `~/.omp/agent/editor-context-bridge.json` with `0600` permissions.
- The VS Code extension reads that file and sends the token on each request.

## Research notes

- OpenCode's VS Code extension binds `Ctrl+Alt+K` on Linux/Windows and `Cmd+Alt+K` on macOS to insert an `@file#Lx-Ly` reference. Its TUI exposes `POST /tui/append-prompt` for prompt insertion.
- Claude Code's current documented shortcut is `Alt+K` on Linux/Windows and `Option+K` on macOS for **Insert @-Mention Reference**. Its extension also sees selected text automatically.
- OMP has extension UI methods including `pasteToEditor` and `sendUserMessage`, but no built-in VS Code selection bridge. This repo supplies that missing bridge.
