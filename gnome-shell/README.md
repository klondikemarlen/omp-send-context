# GNOME Shell Companion

This directory owns the native GNOME Shell companion. Released installation and shortcut configuration belong in the [GNOME product guide](/docs/product/gnome-shell.md).

The approved version 8 is Ptyxis-only and reads PRIMARY selection. Candidate version 9 adds an explicit, generic handoff based only on the focused application's AT-SPI Text selection; it never reads PRIMARY or CLIPBOARD. Version 9 remains unapproved and unlisted, and requires OMP plugin 2.10.0 or newer.

## Architecture and runtime

This directory contains a native GNOME Shell extension. It runs in GJS because GNOME Shell exposes window, shortcut, and notification interfaces through its own `resource:///` modules and `gi://` libraries; a Node or browser runtime cannot load those shell APIs directly.

The implementation keeps responsibilities separate:

- `extension.js` owns Shell lifecycle, focused-window interaction, the user-invoked shortcut, and notifications.
- `context.js` applies exact canonical desktop-ID blocklist policy and shapes bounded selected text and window metadata into the generic GNOME envelope.
- `selection.js` captures the focused application's AT-SPI Text selection in a bounded, short-lived worker without using desktop selection buffers.
- `bridge.js` reads and validates OMP bridge state, then sends the authenticated envelope using GJS's Gio, GLib, and Soup APIs.

Each asynchronous capture is scoped to the Shell-side session that started it. Once that session is invalidated, later completions and errors are ignored rather than notifying or logging stale work. Closing the bridge client is idempotent and aborts in-flight HTTP requests; it cannot retract a handoff the local OMP bridge has already accepted.

GJS is not interchangeable with Node.js or a browser. In particular, GJS 1.88 does not provide the global `URL` used by Node and browsers. Bridge URI parsing therefore uses `GLib.Uri`; Node-only tests can miss incompatibilities with the extension's actual runtime.

## Package and discovery

The extension is packaged as a GNOME Shell ZIP with its metadata and settings schema. Installing or replacing that ZIP does not replace code already imported by the running Shell. The native-runtime checks and exact-ZIP desktop acceptance procedure are in the [GNOME Shell QA guide](/docs/qa-scenarios/gnome-shell.md); contributor checks are in the [development workflow](/docs/workflows/development.md), and publication approval remains covered by the [release workflow](/docs/workflows/release.md).
