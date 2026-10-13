# GNOME Shell Companion — Work in Progress

This companion is unreleased work in progress, not a supported installation path for OMP Send Context. These notes are for local development and review only. They are intentionally excluded from the project's core user documentation.

The prototype reads the focused Ptyxis window's PRIMARY selection and sends it through the active OMP bridge. It does not patch or inject into Ptyxis; Ptyxis has no supported plugin ABI for this integration. The current metadata targets GNOME Shell 50.

## Local installation and fresh-session QA

Run these commands from the repository root as the desktop user who will test the extension:

```bash
npm run test:gnome
npm run install:gnome
```

The headless test installs the ZIP into a disposable GNOME Shell and asserts `ACTIVE`. It does not change the running desktop or prove focused Ptyxis selection, shortcut handling, or OMP delivery.

A locally installed ZIP is discovered by a fresh GNOME Shell session. Replacing an already discovered extension also leaves its imported code in memory; disabling/enabling does not unload it. On Wayland, start a fresh session before testing the new code.

A separate local test account can supply that fresh session through Fast User Switching while leaving the primary account signed in. Log out and back into the test account only after installation. Extension files, GSettings, and the OMP process belong to the testing account; do not copy credentials or bridge state between accounts.

After the fresh test session starts:

```bash
gnome-extensions enable omp-send-context-gnome@klondikemarlen.github.io
gnome-extensions info omp-send-context-gnome@klondikemarlen.github.io
```

The schema intentionally has no default shortcut because GNOME review guidelines prohibit default keyboard shortcuts for clipboard access. Configure an opt-in shortcut using the locally installed schema:

```bash
UUID='omp-send-context-gnome@klondikemarlen.github.io'
SCHEMA_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID/schemas"

GSETTINGS_SCHEMA_DIR="$SCHEMA_DIR" \
  gsettings set org.gnome.shell.extensions.omp-send-context \
  desktop-shortcut "['<Control><Alt><Shift>k']"

GSETTINGS_SCHEMA_DIR="$SCHEMA_DIR" \
  gsettings get org.gnome.shell.extensions.omp-send-context desktop-shortcut
```

The compositor owns the registered accelerator; there is no supported consume-and-re-send operation or shortcut pass-through.

Start a fresh OMP process in the same account and confirm `~/.omp/agent/editor-context-bridge.json` exists without printing its token. Select text in a focused Ptyxis window and invoke the configured shortcut. End-to-end success requires one prompt insertion and the visible **Context sent to OMP.** notification. No-selection, unsupported-focus, and bridge errors should be visible. Headless activation alone does not establish this result.

## Diagnose or remove a local install

From the repository root:

```bash
npm run diagnose:gnome
```

This reports the installed extension, running Shell and installed-file timestamps, its import, and timestamped boot logs. Use `Alt+F2`, enter `lg`, and inspect **Extensions** for current-session errors. If installed code is newer than the running Shell, start a fresh session to rule out old imported modules.

To remove the test install:

```bash
gnome-extensions uninstall omp-send-context-gnome@klondikemarlen.github.io
```

## Archive and static review

```bash
npm run package:gnome
unzip -l /tmp/omp-send-context-gnome/omp-send-context-gnome@klondikemarlen.github.io.shell-extension.zip
python -m pip install -U shexli
shexli "$PWD/gnome-shell"
shexli /tmp/omp-send-context-gnome/omp-send-context-gnome@klondikemarlen.github.io.shell-extension.zip
```

Use the repository's asdf Python when available. The `EGO-A-005 manual_review` finding for `St.Clipboard.get_default()` is intentional: PRIMARY clipboard access is declared and happens only after an explicit user-configured shortcut. Address other findings before submission. The archive must not contain `schemas/gschemas.compiled`.

## Deployment remains paused

**DO NOT UPLOAD.** GNOME review rejected version 7 for including `schemas/gschemas.compiled`: “No change. Also, `schemas/gschemas.compiled` shouldn't be included in the package.” Existing listing history is not evidence that this work-in-progress companion is ready for users.

`upload-gnome.mjs` keeps deployment disabled and stops before prompting, reading credentials, or making network requests. Do not remove that safeguard as part of local testing.

Before enabling deployment or submitting any future version, provide the maintainer with:

1. The ZIP diff against the active submitted version and why each changed file alters user-visible behavior.
2. Local evidence: headless activation, fresh-session Ptyxis-to-OMP shortcut delivery, and every `shexli` finding with its disposition.
3. Relevant GNOME reviewer feedback.

Obtain explicit confirmation in the current conversation after this explanation. A generic publish/release instruction is not approval for a GNOME submission. Review and public listing acceptance remain external.
