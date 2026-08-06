#!/usr/bin/env sh
set -eu

readonly UUID='omp-send-context-gnome@klondikemarlen.github.io'
readonly EXTENSION_ZIP="/tmp/omp-send-context-gnome/$UUID.shell-extension.zip"
readonly SCHEMA_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID/schemas"
readonly DISPLAY_NAME='omp-context-qa'

if test ! -x /usr/libexec/mutter-devkit; then
  echo "Missing /usr/libexec/mutter-devkit. Install the Mutter Development Kit (Ubuntu: sudo apt install mutter-dev-bin)." >&2
  exit 1
fi

npm run package:gnome
gnome-extensions install --force "$EXTENSION_ZIP"

config_dir=$(mktemp -d "${TMPDIR:-/tmp}/omp-send-context-qa.XXXXXX")
cleanup_config() {
  rm -rf "$config_dir"
}
trap cleanup_config EXIT HUP INT TERM

env UUID="$UUID" SCHEMA_DIR="$SCHEMA_DIR" DISPLAY_NAME="$DISPLAY_NAME" \
  SHORTCUT="['<Control><Alt><Shift>k']" XDG_CONFIG_HOME="$config_dir" \
  dbus-run-session -- sh -eu -c '
    cleanup_shell() {
      test -n "${shell_pid:-}" && kill "$shell_pid" 2>/dev/null || true
    }
    trap cleanup_shell EXIT HUP INT TERM

    GSETTINGS_SCHEMA_DIR="$SCHEMA_DIR" gsettings set \
      org.gnome.shell.extensions.omp-send-context desktop-shortcut "$SHORTCUT"

    gnome-shell --devkit --wayland --wayland-display="$DISPLAY_NAME" &
    shell_pid=$!

    attempt=0
    while test "$attempt" -lt 300; do
      if test -S "$XDG_RUNTIME_DIR/$DISPLAY_NAME" &&
        gdbus call --session --dest org.gnome.Shell \
          --object-path /org/gnome/Shell \
          --method org.gnome.Shell.Eval "42" >/dev/null 2>&1; then
        break
      fi
      sleep 0.1
      attempt=$((attempt + 1))
    done
    test "$attempt" -lt 300 || {
      echo "Nested GNOME Shell did not become ready" >&2
      exit 1
    }

    gnome-extensions enable "$UUID"
    gdbus call --session --dest org.gnome.Shell.Extensions \
      --object-path /org/gnome/Shell/Extensions \
      --method org.gnome.Shell.Extensions.GetExtensionInfo "$UUID" \
      | grep "state.*<1.0>" >/dev/null

    echo "Nested GNOME extension is ACTIVE. Select text in Ptyxis and press Ctrl+Alt+Shift+K."
    WAYLAND_DISPLAY="$DISPLAY_NAME" ptyxis
  '
