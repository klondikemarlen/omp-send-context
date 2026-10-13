# VS Code-compatible editor

Use the editor client when you want to send the active VS Code or Devin Desktop selection to OMP. The default shortcut is `Ctrl+Alt+K` on Linux and Windows, or `Cmd+Alt+K` on macOS. It is available while an editor has focus.

## Install or update

The Marketplace extension is **Oh My Pi Send Context** (`klondikemarlen.omp-send-context`). Install it through the client's Extensions view or CLI:

```bash
# Devin Desktop
devin-desktop --install-extension klondikemarlen.omp-send-context --force

# VS Code
code --install-extension klondikemarlen.omp-send-context --force
```

Marketplace installs normally update automatically unless extension auto-update is disabled. To check the installed version in Devin Desktop:

```bash
devin-desktop --list-extensions --show-versions | grep '^klondikemarlen.omp-send-context@'
```

The editor extension and OMP plugin are separate installs. Install or update the OMP plugin from GitHub with:

```bash
omp plugin install github:klondikemarlen/omp-send-context
```

If the old `omp-vscode-context` package is installed, uninstall it once before installing the renamed package:

```bash
omp plugin uninstall omp-vscode-context
omp plugin install github:klondikemarlen/omp-send-context
```

After changing the OMP plugin, restart OMP or run `/reload-plugins`. The supported OMP runtime floor is 16.3.7; Linux focus routing requires OMP 16.5.1 or newer.

## Choose what the shortcut sends

Configure these in **Settings → Extensions → OMP Send Context for VS Code** (or in settings JSON):

- `ompContext.insertMode`: controls `Ctrl+Alt+K` / `Cmd+Alt+K`.
  - `agentHandoff` (default) inserts a bounded `# OMP Agent Handoff` packet with the active editor reference and workspace root.
  - `editorContext` inserts the smaller active-file/selection prompt.
- `ompContext.contentMode`: controls how selected text is represented in either mode.
  - `inline` (default) includes the `@file#LxCy-LxCy` reference and selected text in a fenced code block. This preserves the selection directly in the prompt, subject to the handoff packet's byte limit.
  - `reference` sends only the file/selection reference, allowing OMP to read the file instead.
- `ompContext.handoffIncludeDiagnostics`: includes VS Code diagnostics in handoff packets; default is `false`.

The separate **OMP Context: Insert Agent Handoff Packet** command is a one-time handoff override even when the shortcut is configured for `editorContext`.

Advanced settings:

- `ompContext.endpoint`: optional pinned loopback endpoint (`http://127.0.0.1:<port>`). Empty (default) discovers the most recently active live OMP console. A configured endpoint remains pinned and uses that console's discovered credentials; it does not fall back to an arbitrary default port.
- `ompContext.handoffMaxBytes`: maximum handoff packet size; default `20000` bytes.
- `ompContext.handoffMaxDiagnostics`: maximum included diagnostics when diagnostics are enabled; default `20`.

## Multiple OMP terminals

Each OMP terminal has its own authenticated local bridge. The editor extension discovers the most recently active live console and checks process identity before sending, so a restarted console or reused port is not silently treated as the same target.

Session switches and terminal activity on Linux can select the current console. Closing the selected console promotes the most recently active live survivor. Use `/ide` in a terminal to select that console once and restore its enabled autofocus listener. `/ide` does not pin future routing: activity in another console may select it next. An explicit autofocus opt-out remains disabled.

Use `/ide status` to display the loaded plugin version and endpoint. In the TUI, type `/ide ` and press Tab to complete `status`.

On Linux, **Claim IDE context on focus** in OMP **Settings → Plugins → omp-send-context** is enabled by default. Set it to `false` to disable focus routing, or launch OMP with `--claim-ide-context-on-focus` to force it on for that process. The setting affects Linux only. Changing it starts or stops focus reporting in running Linux OMP instances without a reload; the command-line override is per process.

Focus-in selects a console; the first focus-out can also select it because a newly started console may have been focused before reporting was enabled. Later focus-outs do not steal another console's selection. Keyboard input also selects a console, but terminal probe replies do not. With a multiplexer, forward xterm focus reports if focus-only routing is needed; otherwise keyboard interaction and `/ide` remain available. A cancelled session transition can prevent OMP's listener-recovery hook from running; run `/ide` in that terminal to restore enabled autofocus.

After updating the extension or OMP plugin, restart or reload every OMP console and reload the editor window so existing processes do not continue using code loaded before the update.

## Privacy and delivery

Sending is explicit. The handoff packet may include selected text, local workspace paths, and—only when enabled—VS Code diagnostics. Obvious `token=`, `secret=`, `password=`, `apiKey=`, and `authorization=` diagnostic values are redacted, but review the prompt before submitting sensitive workspace data.

If the OMP bridge cannot be reached, the extension copies the same context packet to the clipboard. For delivery issues see [Troubleshooting](troubleshooting.md).
