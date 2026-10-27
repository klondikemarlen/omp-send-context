# GNOME Shell Companion QA

This guide covers local candidates and release review. The [product guide](/docs/product/gnome-shell.md) describes the currently approved version 8 and the unreleased version 9 candidate. Keep candidate QA in a separate desktop account; do not copy credentials, OMP configuration, bridge state, or extension settings from the primary account.

## Prerequisites

Use the Node version from `.tool-versions` and the repository lockfile. Native GJS bridge scenarios require GJS plus its Soup introspection binding (`gir1.2-soup-3.0`). The full `npm run test:gnome` check additionally needs `dbus-run-session` and `gnome-shell-test-tool`; extension metadata targets GNOME Shell 50.

Candidate version 9 requires OMP plugin **2.10.0 or newer**, a fresh OMP process, a `gjs` executable, and AT-SPI introspection (`gir1.2-atspi-2.0`). The active desktop session must have the accessibility services needed by the focused application; if they are unavailable, selection capture must fail visibly rather than fall back to a desktop selection buffer.

The currently approved GNOME Extensions listing is version 8, which remains Ptyxis-only. Version 9 is a candidate, not a listing release. Do not upload or submit it to GNOME Extensions without explicit maintainer approval.

## What each check proves

- Native GJS bridge tests read and validate OMP state and exercise authenticated delivery in GJS against an isolated local receiver. Node-only tests do not prove this runtime boundary: GJS 1.88 has no global `URL`, which is available in Node and browsers. This distinction follows the failure recorded in [#177](https://github.com/klondikemarlen/omp-send-context/issues/177), the native-runtime fix and regressions in [#178](https://github.com/klondikemarlen/omp-send-context/pull/178), and separate-account delivery acceptance in [#157](https://github.com/klondikemarlen/omp-send-context/issues/157).
- `npm run test:gnome` runs the native bridge tests, packages the extension, checks that the ZIP excludes `schemas/gschemas.compiled`, then verifies `ACTIVE` in a disposable headless GNOME Shell. It does not exercise the real desktop, accessibility selection, shortcut handling, focus transitions, or insertion into the active OMP prompt.
- Desktop acceptance below exercises the exact locally installed candidate ZIP in a fresh test-account Shell with real applications and a fresh OMP process. CI, Node doubles, and headless activation are not substitutes for this manual boundary.

The `GNOME native bridge` Quality job installs GJS and Soup bindings and runs the GNOME test files. The ordinary Node suite can skip native scenarios when GJS is absent; a passing run with those skips is not evidence that GJS executed them. See the [development workflow](/docs/workflows/development.md#gnome-shell-development) for this boundary and command ownership.

## Test the exact candidate ZIP

Use an independent checkout and account for local desktop QA. Fast User Switching allows the test account's GNOME session to run while the primary account remains signed in. Keep the test account's `HOME`, OMP state, and extension settings separate; never copy provider credentials or bridge files between accounts.

Changing `HOME` or `XDG_DATA_HOME` alone does not isolate Shell-management commands. `gnome-extensions uninstall` talks to the desktop's running Shell over D-Bus and can remove that account's live extension even when installation used a disposable directory. Run enable, disable, and uninstall checks only in the separate test account's desktop session, not from a temporary-HOME shell in the primary session.

From the repository checkout in the test account, link the local OMP plugin, run the native/package check, then install the exact ZIP it produced:

```bash
npm ci
omp plugin link "$PWD"
npm run test:gnome

ZIP="$(node bin/gnome archive-path)"
sha256sum "$ZIP"
gnome-extensions install --force "$ZIP"
```

`npm run test:gnome` writes the candidate ZIP at that path. `bin/gnome` isolates the output by user ID so a separate test account does not overwrite another account's archive. `npm run install:gnome` packages again before installing; do not use it when the goal is to accept the exact ZIP just checked. Record the ZIP's SHA-256 with the QA result. If source changes after that hash or check, package and test a new candidate, then install that new candidate.

## Static archive review

Before logging out, run these commands from the checkout in the same terminal where `ZIP` was set. Review the candidate that will receive desktop acceptance; do not rebuild it between checks.

Use the repository's asdf Python when available. If `shexli` is not installed, install it with `python -m pip install -U shexli` using that interpreter.

```bash
unzip -l "$ZIP"
shexli "$PWD/gnome-shell"
shexli "$ZIP"
```

The archive must not contain `schemas/gschemas.compiled`. Review the AT-SPI worker and selection path for the documented focused-process boundary; the previous `St.Clipboard.get_default()` PRIMARY review finding applies to released version 8, not this candidate. Explain and resolve every other finding before any publication request. Do not upload the candidate; see the [release workflow](/docs/workflows/release.md#gnome-shell-companion) for the separate approval gate.

## Fresh test-account desktop acceptance

After installing the ZIP, log out of the test account only and log back into that account. This starts a new GNOME Shell that discovers the installed ZIP and imports its code. Disabling/enabling an extension or restarting applications does not unload code already imported by the current Shell. The primary desktop account may remain signed in.

In the fresh test-account Shell, enable and inspect the extension:

```bash
gnome-extensions enable omp-send-context-gnome@klondikemarlen.github.io
gnome-extensions info omp-send-context-gnome@klondikemarlen.github.io
```

There is no default shortcut. GNOME review guidance prohibits default clipboard shortcuts; configure an explicit, test-account-only accelerator using the installed schema:

```bash
UUID='omp-send-context-gnome@klondikemarlen.github.io'
SCHEMA_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID/schemas"

GSETTINGS_SCHEMA_DIR="$SCHEMA_DIR" \
  gsettings set org.gnome.shell.extensions.omp-send-context \
  desktop-shortcut "['<Control><Alt><Shift>k']"

GSETTINGS_SCHEMA_DIR="$SCHEMA_DIR" \
  gsettings get org.gnome.shell.extensions.omp-send-context desktop-shortcut
GSETTINGS_SCHEMA_DIR="$SCHEMA_DIR" \
  gsettings get org.gnome.shell.extensions.omp-send-context blocked-applications
```

The compositor owns the registered accelerator. It is globally grabbed and has no pass-through: a blocked application does not receive the key instead. Keep it distinct from Firefox and editor integration shortcuts.

### Capture from an allowed application

Open a fresh OMP 2.10.0-or-newer process in the same test account after linking the checkout. OMP loads extension modules at process startup, so an existing process may retain older code even when the link is corrected. Confirm the fresh process uses the checkout-linked plugin and that `~/.omp/agent/editor-context-bridge.json` exists without printing or copying its contents. With multiple OMP consoles, run `/ide` in the intended receiving console before testing.

In a real GNOME Text Editor window (or another real application verified to expose a focused AT-SPI Text selection), select harmless synthetic text and invoke the fallback shortcut once. Keep the window focused until delivery completes. **PASS** requires a visible success notification and exactly one generic `gnome` handoff in the intended fresh OMP prompt, containing the selected text, canonical application identity, and title but no fabricated URL or editor path. Review the inserted handoff.

### Reject blocked apps and preserve embedded integrations

Use the actual installed package variants of **Firefox**, **Visual Studio Code**, and **Devin Desktop**. In each app, select harmless synthetic text, focus its window, and invoke the GNOME fallback shortcut once. Verify the visible blocked-app notification and that no GNOME handoff appears in OMP. The app's embedded integration must remain independent: invoke its own distinct supported shortcut and verify its normal rich handoff is inserted exactly once. The GNOME shortcut must neither trigger that integration nor replay a key into the application.

For each installed package type, record the focused window's canonical desktop ID and confirm that exact ID appears in `blocked-applications`; do not infer it from a display name or use substring matching. Test installed native, Snap, or Flatpak variants that are actually present in the test account.

### Reject unsupported and changed-focus selections

Focus a real application that does not expose a selected range through a focused AT-SPI Text accessible (for example, GNOME Settings), invoke the shortcut once, and verify a visible failure with no OMP handoff. Do not accept text read from PRIMARY or CLIPBOARD as a pass.

For focus safety, select harmless text in a supported application and invoke the shortcut, then change focus to another window before the asynchronous capture completes. **PASS** requires a visible failure and no handoff from either the old selection or the newly focused window. Select fresh synthetic text in the second supported window and invoke once; verify that only the intended current application's selection is inserted, exactly once, in the intended OMP console.

## Evidence and privacy

Record the checkout revision, candidate ZIP SHA-256, GJS and GNOME Shell versions, installed app names/package formats/versions and canonical desktop IDs, OMP version and confirmation that the linked checkout was loaded, extension state, and PASS/FAIL/BLOCKED for each desktop scenario. If blocked, name the boundary that could not run; do not describe CI or headless success as desktop acceptance.

Do not include selected text, prompt contents, bridge state or tokens, provider credentials, raw configuration, screenshots containing test content, or machine-session process IDs in public evidence. The user-visible notification need not be independently captured in a screenshot if the maintainer confirms it; report the confirmation accurately.

## Diagnose or remove a local install

To inspect the installed extension, Shell age, and current-session logs, run `npm run diagnose:gnome` from the checkout and inspect GNOME Looking Glass (`Alt+F2`, enter `lg`) for extension errors. If the installed file is newer than the running Shell, create a fresh Shell session before diagnosing new code.

To remove the local test installation:

```bash
gnome-extensions uninstall omp-send-context-gnome@klondikemarlen.github.io
```
