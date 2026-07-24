import { chmod, mkdir, writeFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"
import { spawnSync } from "node:child_process"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const HOST_PATH = resolve(REPO_ROOT, "firefox/native-host/omp-send-context-host.mjs")
const HOST_NAME = "omp_send_context"
const EXTENSION_ID = "omp-send-context@klondikemarlen.github.io"
const MANIFEST_PATH = resolve(homedir(), ".mozilla/native-messaging-hosts", `${HOST_NAME}.json`)
const PROXY_SERVICE_PATHS = [
  "/usr/share/dbus-1/services/org.freedesktop.NativeMessagingProxy.service",
  "/usr/lib/systemd/user/xdg-native-messaging-proxy.service",
]

export function createHostManifest(hostPath = HOST_PATH) {
  return {
    name: HOST_NAME,
    description: "OMP Send Context Firefox native messaging host",
    path: hostPath,
    type: "stdio",
    allowed_extensions: [EXTENSION_ID],
  }
}

function commandSucceeds(command, args) {
  return spawnSync(command, args, { stdio: "ignore" }).status === 0
}

export function isSandboxedFirefoxInstalled() {
  return commandSucceeds("snap", ["list", "firefox"]) || commandSucceeds("flatpak", ["info", "org.mozilla.firefox"])
}
export function isNativeMessagingProxyInstalled(servicePaths = PROXY_SERVICE_PATHS) {
  return servicePaths.some(path => {
    try {
      const content = readFileSync(path, "utf8")
      return content.includes("org.freedesktop.NativeMessagingProxy") && content.includes("xdg-native-messaging-proxy")
    } catch {
      return false
    }
  })
}

function requireSandboxProxy(required, servicePaths) {
  if (required && !isNativeMessagingProxyInstalled(servicePaths)) {
    throw new Error(
      "Sandboxed Firefox requires xdg-native-messaging-proxy. " +
      "Install the equivalent supported package (Ubuntu 26.04/Resolute: sudo apt install xdg-native-messaging-proxy), then rerun npm run install:firefox-host -- --sandboxed.",
    )
  }
}

export async function installFirefoxHost({
  sandboxed = false,
  servicePaths,
  hostPath = HOST_PATH,
  manifestPath = MANIFEST_PATH,
} = {}) {
  requireSandboxProxy(sandboxed, servicePaths)
  await chmod(hostPath, 0o755)
  await mkdir(dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, `${JSON.stringify(createHostManifest(hostPath), null, 2)}\n`, "utf8")
  return manifestPath
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sandboxed = process.argv.includes("--sandboxed")
  try {
    console.log(`Installed Firefox native host manifest: ${await installFirefoxHost({ sandboxed })}`)
    if (sandboxed) {
      console.log("xdg-native-messaging-proxy D-Bus service is installed for sandboxed Firefox.")
    } else if (isSandboxedFirefoxInstalled() && !isNativeMessagingProxyInstalled()) {
      console.warn("Sandboxed Firefox detected without xdg-native-messaging-proxy; rerun with --sandboxed after installing it.")
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
