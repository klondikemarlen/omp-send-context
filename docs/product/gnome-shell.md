# GNOME Shell: Ptyxis context

The [OMP Send Context GNOME extension](https://extensions.gnome.org/extension/10625/omp-send-context/) sends PRIMARY selections while a Ptyxis window is focused. The approved version 8 targets **GNOME Shell 50**; its [GNOME review record](https://extensions.gnome.org/review/76899) records approval on October 21, 2026. GNOME's extension version is independent of the OMP plugin version.

This is a Ptyxis-only companion, not a general desktop capture tool. Keep the Firefox and VS Code/Devin clients for their richer browser and editor context.

## Install

1. Install the OMP plugin in the same desktop account:

   ```bash
   omp plugin install github:klondikemarlen/omp-send-context
   ```

2. Start a fresh OMP process. See the [editor guide](/docs/product/editor.md#install-or-update) for OMP requirements and updates.
3. Install the companion from its [GNOME Extensions listing](https://extensions.gnome.org/extension/10625/omp-send-context/) on GNOME Shell 50. For a manual download, select Shell 50 and extension version 8, then install that downloaded ZIP:

   ```bash
   gnome-extensions install /path/to/downloaded.shell-extension.zip
   ```

4. Log out and back into this desktop account after installation so a fresh GNOME Shell discovers the extension. Installing a replacement ZIP or disabling/re-enabling an extension does not replace code already imported by the running Shell.
5. Enable it and inspect the installed version and state:

   ```bash
   gnome-extensions enable omp-send-context-gnome@klondikemarlen.github.io
   gnome-extensions info omp-send-context-gnome@klondikemarlen.github.io
   ```

Use the published ZIP, not `npm run install:gnome`, for a released installation. The repository command builds a local development candidate.

## Configure your shortcut

There is **no default shortcut**. Choose an unused accelerator; the following example uses **Ctrl+Alt+Shift+K**:

```bash
UUID='omp-send-context-gnome@klondikemarlen.github.io'
SCHEMA_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID/schemas"

GSETTINGS_SCHEMA_DIR="$SCHEMA_DIR" \
  gsettings set org.gnome.shell.extensions.omp-send-context \
  desktop-shortcut "['<Control><Alt><Shift>k']"

GSETTINGS_SCHEMA_DIR="$SCHEMA_DIR" \
  gsettings get org.gnome.shell.extensions.omp-send-context desktop-shortcut
```

GNOME grabs this shortcut globally. It does not pass through to Firefox or your editor when those applications are focused, even though the companion refuses capture there. Keep it distinct from their embedded integration shortcuts.

## Send context

1. Leave a fresh OMP prompt open in the same account. With multiple consoles, run `/ide` in the intended receiving console; later supported terminal activity can change that selection. See [terminal routing](/docs/product/troubleshooting.md).
2. Focus Ptyxis and freshly select harmless terminal text with the mouse. Keep that window focused until delivery completes.
3. Press your configured shortcut once.
4. Confirm the **Context sent to OMP.** notification and one handoff in the intended OMP prompt. Review the text before submitting it to your model.

The handoff includes application identity, window title, and bounded selected text. It does not invent file paths, browser URLs, diagnostics, or line ranges. Delivery failures produce a notification; unlike the editor and Firefox clients, the GNOME companion does **not** copy a fallback packet to CLIPBOARD.

## Selection and privacy limits

PRIMARY is the desktop selection buffer, not the ordinary copy/paste CLIPBOARD. This version checks that Ptyxis is focused, but the global PRIMARY API does not prove which application owns the text. A previous selection can survive a focus change. Always make a new selection in the focused Ptyxis window immediately before invoking the shortcut, and inspect the inserted handoff; do not rely on the focus check as a selection-provenance guarantee.

The companion reads PRIMARY only when you invoke its shortcut in a recognized Ptyxis window. It does not monitor selections in the background or substitute CLIPBOARD content. Selected text and window titles can contain secrets; use non-sensitive content and review the handoff before sending it to a model. Delivery uses the same account's authenticated local OMP bridge.

## Update or remove

Use GNOME Extensions to obtain compatible approved updates. For a downloaded replacement ZIP, use `gnome-extensions install --force /path/to/downloaded.shell-extension.zip`, then log out and back in before exercising the new code. Verify the installed version and state with `gnome-extensions info` as above. Update the OMP plugin separately and restart its consoles.

To remove the companion:

```bash
gnome-extensions uninstall omp-send-context-gnome@klondikemarlen.github.io
```

For contributor candidates, native-runtime checks, and separate-account desktop acceptance, use the [GNOME QA guide](/docs/qa-scenarios/gnome-shell.md). Future uploads still require the [maintainer approval gate](/docs/workflows/release.md#gnome-shell-companion).
