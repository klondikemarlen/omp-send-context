import { spawn } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createFirefoxBuildSource } from "./source-provenance.mjs"

const issuer = process.env.AMO_API_ISSUER
const secret = process.env.AMO_API_SECRET
if (!issuer || !secret) {
  throw new Error("AMO_API_ISSUER and AMO_API_SECRET must be exported before signing")
}

const channel = process.env.AMO_CHANNEL ?? "listed"
if (channel !== "listed" && channel !== "unlisted") {
  throw new Error("AMO_CHANNEL must be listed or unlisted")
}

const buildSource = await createFirefoxBuildSource({ requireClean: true })
try {
  const webExtCommand = process.platform === "win32" ? "web-ext.cmd" : "web-ext"
  const webExtArguments = [
    "sign",
    "--source-dir",
    buildSource.sourceDirectory,
    "--artifacts-dir",
    join(tmpdir(), "omp-send-context-firefox"),
    "--ignore-files",
    "native-host/**",
    "native-host/",
    "scripts/**",
    "scripts/",
    "--amo-metadata",
    "docs/firefox-amo-metadata.json",
    "--approval-timeout",
    "0",
    "--channel",
    channel,
  ]

  await new Promise((resolve, reject) => {
    const child = spawn(webExtCommand, webExtArguments, {
      env: {
        ...process.env,
        WEB_EXT_API_KEY: issuer,
        WEB_EXT_API_SECRET: secret,
      },
      stdio: "inherit",
    })
    child.on("error", reject)
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`web-ext exited with code ${code}`))
    )
  })
} finally {
  await buildSource.cleanup()
}
