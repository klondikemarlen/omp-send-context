import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { createHostLauncher, createHostManifest, installFirefoxHost, isNativeMessagingProxyInstalled } from "../../firefox/scripts/install-firefox-host.mjs"

const execFileAsync = promisify(execFile)

test("Firefox host installer creates the registered native-messaging manifest", () => {
  const manifest = createHostManifest("/checkout/firefox/native-host/omp-send-context-host.mjs")

  assert.deepEqual(manifest, {
    name: "omp_send_context",
    description: "OMP Send Context Firefox native messaging host",
    path: "/checkout/firefox/native-host/omp-send-context-host.mjs",
    type: "stdio",
    allowed_extensions: ["omp-send-context@klondikemarlen.github.io"],
  })
})

test("Firefox host installer writes a launcher-backed manifest and executable files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "omp-send-context-"))
  const hostPath = join(directory, "omp-send-context-host.mjs")
  const launcherPath = join(directory, "omp_send_context-host")
  const manifestPath = join(directory, "native-messaging-hosts", "omp_send_context.json")
  const nodePath = "/opt/node/bin/node"

  try {
    await writeFile(hostPath, "#!/usr/bin/env node\n")
    await installFirefoxHost({ hostPath, launcherPath, manifestPath, nodePath })

    assert.deepEqual(JSON.parse(await readFile(manifestPath, "utf8")), createHostManifest(launcherPath))
    assert.equal(await readFile(launcherPath, "utf8"), createHostLauncher(nodePath, hostPath))
    assert.equal((await stat(hostPath)).mode & 0o111, 0o111)
    assert.equal((await stat(launcherPath)).mode & 0o111, 0o111)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("Firefox host installer checks for the proxy D-Bus service registration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "omp-send-context-"))
  const servicePath = join(directory, "org.freedesktop.NativeMessagingProxy.service")

  try {
    assert.equal(isNativeMessagingProxyInstalled([servicePath]), false)
    await assert.rejects(
      installFirefoxHost({ sandboxed: true, servicePaths: [servicePath], hostPath: servicePath, manifestPath: join(directory, "manifest.json") }),
      /requires xdg-native-messaging-proxy/,
    )
    await writeFile(servicePath, "[D-BUS Service]\nName=org.freedesktop.NativeMessagingProxy\nExec=/usr/libexec/xdg-native-messaging-proxy\n")
    assert.equal(isNativeMessagingProxyInstalled([servicePath]), true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("packaged Firefox host registration keeps package paths and stable allowlist", async () => {
  const directory = await mkdtemp(join(tmpdir(), "omp-send-context-package-home-"))
  const packageDirectory = join(process.cwd(), "firefox", "native-host")
  const registrationCommand = join(packageDirectory, "omp-send-context-install-firefox-host")
  const launcherPath = join(packageDirectory, "omp-send-context-native-host")

  try {
    const { stdout } = await execFileAsync(registrationCommand, [], { env: { ...process.env, HOME: directory } })
    const manifestPath = join(directory, ".mozilla", "native-messaging-hosts", "omp_send_context.json")

    assert.match(stdout, new RegExp(`Installed Firefox native host manifest: ${manifestPath}`))
    assert.deepEqual(
      JSON.parse(await readFile(manifestPath, "utf8")),
      JSON.parse(await readFile(join(packageDirectory, "omp_send_context.json"), "utf8")),
    )
    assert.equal(await readFile(launcherPath, "utf8"), '#!/bin/sh\nexec /usr/bin/node /usr/lib/omp-send-context-firefox-host/omp-send-context-host.mjs "$@"\n')
    assert.equal((await stat(launcherPath)).mode & 0o111, 0o111)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
