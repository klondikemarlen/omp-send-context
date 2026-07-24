import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHostManifest, installFirefoxHost, isNativeMessagingProxyInstalled } from "../scripts/install-firefox-host.mjs"

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
