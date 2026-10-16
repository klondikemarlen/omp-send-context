# Firefox

The Firefox add-on sends selected web-page context to OMP only when you explicitly invoke it. It supports Firefox 142 or newer. Install **OMP Send Context** from the [Mozilla Add-ons listing](https://addons.mozilla.org/en-CA/firefox/addon/omp-send-context/); the add-on, OMP plugin, and Linux native-messaging host are separate components.

## Send page context

On an ordinary `http://` or `https://` page:

1. Select text.
2. Press `Ctrl+Alt+K` (Linux/Windows) or `Command+Alt+K` (macOS), or open the page context menu and choose **Send selection and link to OMP**.
3. Check the active OMP prompt. The shortcut can be changed in Firefox's **about:addons → Manage Extension Shortcuts**.

A generic web page packet contains the document title when available, the page URL, and selected text in a fenced block under `## Web page`. On GitHub pull-request pages, the packet uses `## GitHub` and can include a selected diff file, version (`original` or `modified`), change kind, lines, a permalink, and a head commit SHA only when the page exposes it. The URL is retained even when the richer diff metadata is unavailable.

Firefox-protected pages (including Firefox internal pages and AMO), `file:` pages, unsupported URLs, and empty selections are rejected without delivery. The add-on does not request local-file access. It requests access to ordinary HTTP(S) pages so the shortcut works without first clicking the toolbar button.

## Install the Linux native-messaging host

The host is a separate local process that connects the add-on to OMP. On Ubuntu 26.04 (Resolute), the recommended route is the PPA package. It includes a statically linked Go host and does not install or require the Node.js runtime:

```bash
sudo add-apt-repository ppa:klondikemarlen/omp-send-context
sudo apt update
sudo apt install omp-send-context-firefox-host
```

For system Firefox, the package installs the host and system native-messaging manifest. For Firefox installed through Snap or Flatpak, install the sandbox proxy and register its per-user manifest:

```bash
sudo apt install xdg-native-messaging-proxy
omp-send-context-install-firefox-host --sandboxed
```

Run `omp-send-context-install-firefox-host --sandboxed` as your normal desktop user, not with `sudo`. On other distributions install the equivalent `xdg-native-messaging-proxy` package when needed. Review the [proxy security warning](https://github.com/flatpak/xdg-native-messaging-proxy#readme) before enabling it.

For development or distributions without the PPA, install from a checkout; this route uses the Node.js host and requires Node.js 20 or newer:

```bash
# System Firefox
npm run install:firefox-host

# Snap or Flatpak Firefox, after installing xdg-native-messaging-proxy
npm run install:firefox-host -- --sandboxed
```

The checkout installer creates `~/.local/share/omp-send-context/omp_send_context-host` and registers `~/.mozilla/native-messaging-hosts/omp_send_context.json`. The manifest allowlists the extension ID `omp-send-context@klondikemarlen.github.io`. Do not copy it into `~/snap/firefox/` or another sandbox-private directory; the proxy discovers the normal host-manifest location.

After host registration, start a fresh OMP process and restart Firefox if it has not picked up the registration. Native delivery requires both the Firefox add-on and this host. For troubleshooting delivery, see [Troubleshooting](troubleshooting.md).

## Choose the OMP terminal

Run `/ide` in the intended OMP terminal, then send the selected page context. This selects that console once; later real activity in another console can change the destination. Both native-host installation routes discover the most recently active live console, including across other `omp` or `ompi` instances starting, stopping, or restarting in the background.

If Firefox still delivers to another terminal after `/ide`, update the **native host**, not only the OMP plugin or Firefox add-on. For the PPA installation, run `sudo apt update && sudo apt install --only-upgrade omp-send-context-firefox-host`; for the checkout installation, update the checkout used by its launcher. Restart Firefox if it retains an older host connection. See the [multiple-session QA scenario](/docs/qa-scenarios/firefox.md#7-multiple-omp-sessions) for the routing acceptance check.

## Clipboard fallback

When the native host is unavailable or rejects delivery, the add-on copies the exact prompt packet to the clipboard and reports that native delivery was unavailable. This keeps context sending usable without the host, but does not establish that native delivery works. When native delivery is successful, the session debug log contains `native:succeeded`.

## Logging and privacy

The add-on does not send page data automatically, persist captured page context, or collect telemetry. Firefox's manifest declares no required data collection. Page context is captured for an explicit send action and delivered locally through native messaging; if native delivery fails, the exact packet is copied to the clipboard. The host accepts only `http://127.0.0.1:<port>` bridge endpoints and does not log prompts or bearer tokens. Firefox does not receive the bridge token.

The toolbar popup lets you enable opt-in, session-only debug logging. Entries disappear when Firefox restarts. With logging enabled, the **Copy OMP Send Context debug log** action exports bounded stage and error codes plus extension version and source-commit provenance. It does not include selected text, page URLs or titles, prompts, bridge state, or bearer tokens. Debug output exists to help diagnose delivery failures; it is not a page-context history.

## Temporary installation for local testing

For development only, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `firefox/manifest.json`. Firefox removes temporary add-ons when it restarts. For release acceptance procedures, use the [Firefox manual QA scenario](../qa-scenarios/firefox.md).
