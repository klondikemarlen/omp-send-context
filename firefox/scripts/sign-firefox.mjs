import { spawn } from "node:child_process"

const issuer = process.env.AMO_API_ISSUER
const secret = process.env.AMO_API_SECRET
if (!issuer || !secret) {
  throw new Error("AMO_API_ISSUER and AMO_API_SECRET must be exported before signing")
}

const channel = process.env.AMO_CHANNEL ?? "listed"
if (channel !== "listed" && channel !== "unlisted") {
  throw new Error("AMO_CHANNEL must be listed or unlisted")
}

const command = process.platform === "win32" ? "web-ext.cmd" : "web-ext"
const args = [
  "sign",
  "--source-dir", "firefox",
  "--artifacts-dir", "dist/firefox",
  "--ignore-files", "native-host/**", "native-host/", "scripts/**", "scripts/",
  "--amo-metadata", "docs/firefox-amo-metadata.json",
  "--approval-timeout", "0",
  "--channel", channel,
]

await new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    env: {
      ...process.env,
      WEB_EXT_API_KEY: issuer,
      WEB_EXT_API_SECRET: secret,
    },
    stdio: "inherit",
  })
  child.on("error", reject)
  child.on("exit", code => code === 0 ? resolve() : reject(new Error(`web-ext exited with code ${code}`)))
})
