# GNOME Shell context handoffs

The [OMP Send Context GNOME extension](https://extensions.gnome.org/extension/10625/omp-send-context/) is approved as version 8 for **GNOME Shell 50**; its [GNOME review record](https://extensions.gnome.org/review/76899) records approval on October 21, 2026. Version 8 remains the released, Ptyxis-only companion and reads the desktop PRIMARY selection.

Version 9 is a candidate for generic application selection, not an approved or listed release. It requires OMP plugin **2.10.0 or newer** before installing the candidate ZIP. Keep the approved version 8 installed until version 9 has passed desktop QA and the maintainer approves any listing submission. Do not upload the candidate to GNOME Extensions.

## Install the released companion

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

## Candidate version 9: generic application selection

Version 9 is not released. Its single-invocation fallback is intended to send only text exposed as a selected range by the focused application's AT-SPI Text interface. The capture is scoped to that application's process; it does not read the desktop PRIMARY or CLIPBOARD selection. If accessibility services are unavailable, the application exposes no supported focused Text selection, or focus changes during capture, the handoff fails visibly instead of using stale or unrelated text.

The candidate sends a generic `gnome` handoff containing bounded selected text, the canonical application ID, and the window title. It does not add a browser URL, editor file path, workspace, line range, or diagnostics. It does not replace the Firefox or VS Code/Devin integrations.

### Configure the shortcut and blocklist

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

GNOME grabs this shortcut globally. If a focused application is blocked, the extension refuses capture but the accelerator still does **not** pass through to that application. Use a distinct shortcut for the Firefox or editor integration; do not try to replay the intercepted key.

The candidate's `blocked-applications` setting is a list of exact canonical desktop IDs, including `.desktop`. Its defaults cover these verified package identities:

| Application/package                | Blocked desktop ID              |
| ---------------------------------- | ------------------------------- |
| Firefox native package             | `firefox.desktop`               |
| Firefox ESR                        | `firefox-esr.desktop`           |
| Firefox Snap                       | `firefox_firefox.desktop`       |
| Firefox Flatpak                    | `org.mozilla.firefox.desktop`   |
| Visual Studio Code native package  | `code.desktop`                  |
| Visual Studio Code Snap            | `code_code.desktop`             |
| Visual Studio Code Flathub package | `com.visualstudio.code.desktop` |
| Devin Desktop Linux package        | `devin-desktop.desktop`         |

The list is exact, not substring-based. Windows without a canonical desktop-file identity are blocked. To inspect the list in a candidate installation:

```bash
GSETTINGS_SCHEMA_DIR="$SCHEMA_DIR" \
  gsettings get org.gnome.shell.extensions.omp-send-context blocked-applications
```

For identity evidence, see the [Ubuntu Firefox package file list](https://packages.ubuntu.com/jammy/amd64/firefox/filelist), [Debian Firefox ESR package file list](https://packages.debian.org/bookworm/amd64/firefox-esr/filelist), [Canonical's Firefox Snap manifest](https://github.com/canonical/firefox-snap/blob/stable/snapcraft.yaml), the [Snap desktop-file naming rules](https://snapcraft.io/docs/reference/development/yaml-schemas/the-snap-format/), and the [Flathub Firefox app record](https://flathub.org/apps/org.mozilla.firefox) with the [Flatpak desktop-file convention](https://docs.flatpak.org/en/latest/conventions.html#desktop-files). VS Code's [Microsoft Linux installation guide](https://code.visualstudio.com/docs/setup/linux) and [desktop-file template](https://github.com/microsoft/vscode/blob/main/resources/linux/code.desktop) verify the native ID; its [official Snap listing](https://snapcraft.io/code) and the Snap naming rules verify the Snap app identity, while the [community Flathub manifest](https://github.com/flathub/com.visualstudio.code/blob/master/com.visualstudio.code.yaml) verifies the Flatpak ID. Devin's [Linux installation guide](https://docs.devin.ai/desktop/install) identifies the official package, and its [RPM repository file inventory](https://windsurf-stable.codeiumdata.com/wVxQEIWkwPUEAGf3/yum/repo/repodata/0d6f329541389922e3abc6b120f2a8cfe5fe6cb29ef5882d54bc541fd57ccd06-filelists.xml.gz) includes `devin-desktop.desktop`.

### Send a candidate handoff

1. Update the OMP plugin to **2.10.0 or newer**, then start a fresh OMP process in the same desktop account. With multiple consoles, run `/ide` in the intended receiving console; see [terminal routing](/docs/product/troubleshooting.md).
2. Focus a permitted application and select harmless text. The app must expose a focused AT-SPI Text accessible with a selected range.
3. Keep that application focused and press the configured fallback shortcut once.
4. Confirm the visible success notification and exactly one generic handoff in the intended OMP prompt. Review the handoff before submitting it to a model.

Blocked apps, apps without a supported accessible selection, and focus changes during capture fail visibly and send no handoff. The fallback does not monitor selections in the background and never substitutes PRIMARY or CLIPBOARD. Selected text and window titles can contain secrets; use non-sensitive content and review the inserted text before sending it.

## Update or remove

For the released version, use GNOME Extensions to obtain compatible approved updates. For a downloaded replacement ZIP, use `gnome-extensions install --force /path/to/downloaded.shell-extension.zip`, then log out and back in before exercising the new code. Verify the installed version and state with `gnome-extensions info` as above. Update the OMP plugin separately and restart its consoles.

To remove the companion:

```bash
gnome-extensions uninstall omp-send-context-gnome@klondikemarlen.github.io
```

For candidate packaging and separate-account desktop acceptance, use the [GNOME QA guide](/docs/qa-scenarios/gnome-shell.md). Future uploads still require the [maintainer approval gate](/docs/workflows/release.md#gnome-shell-companion).
