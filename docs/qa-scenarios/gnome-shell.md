# GNOME Shell Companion QA

This guide covers local development and review of the unreleased GNOME Shell companion. It is not a supported installation guide. Keep this QA in a separate local test account; do not copy credentials, OMP configuration, bridge state, or extension settings from the primary account.

## Prerequisites

Use the Node version from `.tool-versions` and the repository lockfile. The GJS bridge
scenarios require GJS plus its Soup introspection binding (`gir1.2-soup-3.0`). The full
`npm run test:gnome` check additionally needs `dbus-run-session` and `gnome-shell-test-tool`;
the current extension metadata targets GNOME Shell 50.

## What each check proves

- The native GJS bridge tests read and validate OMP state and exercise authenticated delivery in GJS against an isolated local receiver. Node-only tests do not prove this runtime boundary: GJS 1.88 has no global `URL`, which is available in Node and browsers. This distinction follows the failure recorded in [#177](https://github.com/klondikemarlen/omp-send-context/issues/177), the native-runtime fix and regressions in [#178](https://github.com/klondikemarlen/omp-send-context/pull/178), and separate-account delivery acceptance in [#157](https://github.com/klondikemarlen/omp-send-context/issues/157).
- `npm run test:gnome` runs the native bridge tests, packages the extension, checks that the ZIP excludes `schemas/gschemas.compiled`, then verifies `ACTIVE` in a disposable headless GNOME Shell. It does not exercise the real desktop, focused Ptyxis selection, shortcut handling, or insertion into the active OMP prompt.
- Desktop acceptance below tests the exact locally installed candidate ZIP in a fresh test-account Shell and a fresh OMP process. CI or headless activation is not a substitute for this manual boundary.

The `GNOME native bridge` Quality job installs GJS and Soup bindings and runs the GNOME test files. The ordinary Node suite can skip native scenarios when GJS is absent; a passing run with those skips is not evidence that GJS executed them. See the [development workflow](/docs/workflows/development.md#gnome-shell-development) for this boundary and command ownership.

## Test the exact candidate ZIP

Use an independent checkout and account for local desktop QA. Fast User Switching allows the test account's GNOME session to run while the primary account remains signed in. Keep the test account's `HOME`, OMP state, and extension settings separate; never copy provider credentials or bridge files between accounts.

From the repository checkout in the test account, link the local OMP plugin, run the native/package check, then install the exact ZIP it produced:

```bash
npm ci
omp plugin link "$PWD"
npm run test:gnome

ZIP="${TMPDIR:-/tmp}/omp-send-context-gnome-$(id -u)/omp-send-context-gnome@klondikemarlen.github.io.shell-extension.zip"
sha256sum "$ZIP"
gnome-extensions install --force "$ZIP"
```

`npm run test:gnome` writes the candidate ZIP at that path. `bin/gnome` isolates the output by user ID so a separate test account does not overwrite another account's archive. `npm run install:gnome` packages again before installing; do not use it when the goal is to accept the exact ZIP just checked. Record the ZIP's SHA-256 with the QA result. If source changes after that hash or check, package and test a new candidate, then install that new candidate.

## Fresh test-account desktop acceptance

After installing the ZIP, log out of the test account only and log back into that account. This starts a new GNOME Shell that discovers the installed ZIP and imports its code. Disabling/enabling an extension or restarting Ptyxis does not unload code already imported by the current Shell. The primary desktop account may remain signed in.

In the fresh test-account Shell, enable and inspect the extension:

```bash
gnome-extensions enable omp-send-context-gnome@klondikemarlen.github.io
gnome-extensions info omp-send-context-gnome@klondikemarlen.github.io
```

The extension schema intentionally defines no default shortcut. GNOME review guidance prohibits default clipboard shortcuts; configure an explicit, test-account-only shortcut using the installed schema:

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

Open a fresh OMP process in the same test account after linking the checkout. OMP loads extension modules at process startup, so an existing process may retain the previously installed plugin even when the link is corrected. Confirm the process uses the checkout-linked plugin, not merely a matching plugin version, and confirm `~/.omp/agent/editor-context-bridge.json` exists without printing or copying its contents.

With a harmless, non-sensitive selection in a focused Ptyxis window, invoke the configured shortcut once. **PASS** requires both the visible **Context sent to OMP.** notification and exactly one handoff insertion into that fresh OMP prompt. A headless `ACTIVE` state, successful bridge test, or one of the two desktop observations alone is not a pass. Do not repeat the shortcut just to capture additional evidence.

## Static archive review

Review the same candidate ZIP used for desktop acceptance; do not rebuild it between checks:

Use the repository's asdf Python when available. If `shexli` is not installed, install it with
`python -m pip install -U shexli` using that interpreter.

```bash
unzip -l "$ZIP"
shexli "$PWD/gnome-shell"
shexli "$ZIP"
```

The archive must not contain `schemas/gschemas.compiled`. The `EGO-A-005 manual_review` finding for `St.Clipboard.get_default()` is expected: PRIMARY selection is accessed only after the user-configured shortcut. Explain and resolve every other finding before any publication request. See the [release workflow](/docs/workflows/release.md#gnome-shell-companion-publication-remains-paused) for the separate approval gate.

## Evidence and privacy

Record the checkout revision, candidate ZIP SHA-256, GJS and GNOME Shell versions, OMP version and confirmation that the linked checkout was loaded, extension state, and PASS/FAIL/BLOCKED for the desktop result. If blocked, name the boundary that could not run; do not describe CI or headless success as desktop acceptance.

Do not include selected text, prompt contents, bridge state or tokens, provider credentials, raw configuration, screenshots containing test content, or machine-session process IDs in public evidence. The user-visible notification need not be independently captured in a screenshot if the maintainer confirms it; report the confirmation accurately.

## Diagnose or remove a local install

To inspect the installed extension, Shell age, and current-session logs, run `npm run diagnose:gnome` from the checkout and inspect GNOME Looking Glass (`Alt+F2`, enter `lg`) for extension errors. If the installed file is newer than the running Shell, create a fresh Shell session before diagnosing new code.

To remove the local test installation:

```bash
gnome-extensions uninstall omp-send-context-gnome@klondikemarlen.github.io
```
