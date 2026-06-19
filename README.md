# omp-vscode-context

VS Code + Oh My Pi bridge for sending editor context to OMP with `Ctrl+Alt+K`.

## Intent

**WHY this exists:** OMP can inspect files once prompted, but VS Code owns the active editor, cursor, and selection. A local bridge is required to move that IDE context into the OMP prompt without copy/paste.

**WHAT this produces:** A VS Code command/keybinding plus an OMP extension. The VS Code side captures the active file and selection. The OMP side receives it over loopback HTTP and inserts it into the live OMP prompt.

**Decision Rules:**
- **Use VS Code for editor state:** Selection and cursor state live in VS Code, so the keyboard shortcut is implemented as a VS Code extension.
- **Use OMP for prompt delivery:** OMP prompt editing is owned by OMP, so the repo also ships an OMP extension that exposes a local bridge.
- **Prefer paste over auto-send:** Default behavior inserts context into the prompt instead of submitting it, matching Claude Code/OpenCode reference insertion and keeping the user in control.

## Behavior

Press `Ctrl+Alt+K` on Linux/Windows or `Cmd+Alt+K` on macOS while a VS Code editor is focused.

With a selection, OMP receives:

````text
In @src/example.ts#L7-L9

```typescript
const value = 1
return value
```
````

Without a selection, OMP receives only the current file and line reference:

```text
In @src/example.ts#L7
```

If the OMP bridge is not reachable, the VS Code extension copies the same context block to the clipboard.

## Install locally

Install the OMP extension from a cloned checkout:

```bash
git clone https://github.com/klondikemarlen/omp-vscode-context.git
cd omp-vscode-context
omp install "$PWD"
```

Restart OMP or run `/reload-plugins`.

Install the VS Code extension for development:

```bash
npm install
npm run package:vsix
```

Then run **Developer: Install Extension from Location...** against this folder, or install the generated `.vsix`.

## Concepts

See [CONCEPTS.md](./CONCEPTS.md) for the architecture, data contract, bridge security model, delivery modes, and known limits.

## Settings

- `ompContext.endpoint`: optional endpoint override. Empty uses `~/.omp/agent/editor-context-bridge.json`, then `http://127.0.0.1:47687`.
- `ompContext.delivery`: `paste` (default), `send`, or `nextTurn`.

## Security model

- The OMP bridge binds only to `127.0.0.1`.
- OMP writes a random bearer token to `~/.omp/agent/editor-context-bridge.json` with `0600` permissions.
- The VS Code extension reads that file and sends the token on each request.

## Research notes

- OpenCode's VS Code extension binds `Ctrl+Alt+K` on Linux/Windows and `Cmd+Alt+K` on macOS to insert an `@file#Lx-Ly` reference. Its TUI exposes `POST /tui/append-prompt` for prompt insertion.
- Claude Code's current documented shortcut is `Alt+K` on Linux/Windows and `Option+K` on macOS for **Insert @-Mention Reference**. Its extension also sees selected text automatically.
- OMP has extension UI methods including `pasteToEditor` and `sendUserMessage`, but no built-in VS Code selection bridge. This repo supplies that missing bridge.
