# GNOME Shell Companion

This directory owns the native GNOME Shell companion for Ptyxis context handoffs. Released installation, shortcut configuration, selection limits, and updates belong in the [GNOME product guide](/docs/product/gnome-shell.md).

The companion reads global PRIMARY selection while a recognized Ptyxis window is focused and sends it through the active OMP bridge. The focus check does not establish selection ownership. It does not patch or inject into Ptyxis; Ptyxis has no supported plugin ABI for this integration. The current metadata targets GNOME Shell 50.

## Architecture and runtime

This directory contains a native GNOME Shell extension. It runs in GJS because GNOME Shell exposes the window, clipboard, shortcut, and notification interfaces through its own `resource:///` modules and `gi://` libraries; a Node or browser runtime cannot load those shell APIs directly. Keep the extension on those native interfaces rather than adding a second process or translating shell objects across a runtime boundary.

The implementation keeps three responsibilities separate:

- `extension.js` owns GNOME Shell lifecycle and focused-window interaction, including the user-invoked shortcut and notification.
- `context.js` recognizes Ptyxis and shapes bounded selection and window metadata into the context envelope.
- `bridge.js` reads and validates OMP bridge state, then sends the authenticated envelope using GJS's Gio, GLib, and Soup APIs.

Each asynchronous capture is scoped to the Shell-side session that started it. Once that session is invalidated, later completions and errors are ignored rather than notifying or logging stale work. Closing the bridge client is idempotent and aborts in-flight HTTP requests; it cannot retract a handoff the local OMP bridge has already accepted.

GJS is not interchangeable with Node.js or a browser. In particular, GJS 1.88 does not provide the global `URL` used by Node and browsers. Bridge URI parsing therefore uses `GLib.Uri`; Node-only tests can miss incompatibilities with the extension's actual runtime.

## Package and discovery

The extension is packaged as a GNOME Shell ZIP with its metadata and settings schema. Installing or replacing that ZIP does not replace code already imported by the running Shell. The native-runtime checks and exact-ZIP desktop acceptance procedure are in the [GNOME Shell QA guide](/docs/qa-scenarios/gnome-shell.md); contributor checks are in the [development workflow](/docs/workflows/development.md), and publication approval remains covered by the [release workflow](/docs/workflows/release.md).
