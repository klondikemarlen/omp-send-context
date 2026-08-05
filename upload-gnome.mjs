import { readFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { createInterface } from "node:readline/promises"
import { basename } from "node:path"
import { fileURLToPath } from "node:url"

const API_BASE = "https://extensions.gnome.org/api/v1"
const SECRET_SERVICE = "extensions.gnome.org"
const DEFAULT_PROJECT = "omp-send-context"
const SECRET_PURPOSE = "upload"

export async function uploadGnomeExtension({
  zipPath,
  account,
  project = DEFAULT_PROJECT,
  acceptLicense = false,
  acceptTerms = false,
  fetchImpl = fetch,
  lookupSecret = secretToolLookup,
  prompt = promptAccount,
}) {
  if (!zipPath) {
    throw new Error("--zip is required.")
  }
  const loginAccount = (account ?? await prompt()).trim()
  if (!loginAccount) {
    throw new Error("A GNOME Extensions login is required.")
  }
  if (!acceptLicense || !acceptTerms) {
    throw new Error("Pass --accept-license and --accept-terms after reviewing GNOME Extensions' upload agreements.")
  }
  const password = await lookupSecret({
    service: SECRET_SERVICE,
    project,
    account: loginAccount,
    purpose: SECRET_PURPOSE,
  })
  if (!password) {
    throw new Error("No GNOME Extensions password was found in the desktop Secret Service.")
  }

  const login = await fetchImpl(`${API_BASE}/accounts/login/`, {
    method: "POST",
    body: new URLSearchParams({ login: loginAccount, password }),
    redirect: "manual",
  })
  if (login.status < 200 || login.status >= 400) {
    throw new Error(`GNOME Extensions login failed (${login.status}).`)
  }

  const headers = await loginHeaders(login)
  const source = new File([await readFile(zipPath)], basename(zipPath), { type: "application/zip" })
  const body = new FormData()
  body.set("source", source)
  body.set("shell_license_compliant", "true")
  body.set("tos_compliant", "true")

  const upload = await fetchImpl(`${API_BASE}/extensions`, { method: "POST", headers, body })
  if (upload.status !== 201) {
    throw new Error(`GNOME Extensions upload failed (${upload.status}).`)
  }
}

export async function configureGnomeUpload({
  account,
  project = DEFAULT_PROJECT,
  prompt = promptAccount,
  storeSecret = secretToolStore,
}) {
  const login = (account ?? await prompt()).trim()
  if (!login) {
    throw new Error("A GNOME Extensions login is required.")
  }
  await storeSecret({
    label: "GNOME Extensions upload password",
    service: SECRET_SERVICE,
    project,
    account: login,
    purpose: SECRET_PURPOSE,
  })
}

async function loginHeaders(login) {
  const cookies = login.headers.getSetCookie().map(value => value.split(";", 1)[0])
  const session = cookies.find(value => value.startsWith("sessionid="))
  if (session) {
    const csrf = cookies.find(value => value.startsWith("csrftoken="))
    return {
      Cookie: cookies.join("; "),
      ...(csrf ? { "X-CSRFToken": csrf.slice("csrftoken=".length) } : {}),
    }
  }

  const body = await login.json().catch(() => null)
  if (typeof body?.token === "string" && body.token) {
    return { Authorization: `Token ${body.token}` }
  }
  throw new Error("GNOME Extensions login returned neither a session cookie nor an authorization token.")
}

function secretToolLookup(attributes) {
  const args = ["lookup", ...Object.entries(attributes).flatMap(([name, value]) => [name, value])]
  return new Promise((resolve, reject) => {
    const child = spawn("secret-tool", args, { stdio: ["ignore", "pipe", "ignore"] })
    let secret = ""
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", chunk => { secret += chunk })
    child.on("error", () => reject(new Error("secret-tool is unavailable. Install libsecret-tools and unlock your desktop keyring.")))
    child.on("close", code => {
      if (code === 0) {
        resolve(secret.replace(/\r?\n$/, ""))
      } else {
        reject(new Error("secret-tool could not read the GNOME Extensions password."))
      }
    })
  })
}

function promptAccount() {
  const terminal = createInterface({ input: process.stdin, output: process.stdout })
  return terminal.question("GNOME Extensions login: ").finally(() => terminal.close())
}

function secretToolStore({ label, ...attributes }) {
  const args = ["store", `--label=${label}`, ...Object.entries(attributes).flatMap(([name, value]) => [name, value])]
  return new Promise((resolve, reject) => {
    const child = spawn("secret-tool", args, { stdio: "inherit" })
    child.on("error", () => reject(new Error("secret-tool is unavailable. Install libsecret-tools and unlock your desktop keyring.")))
    child.on("close", code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error("secret-tool could not store the GNOME Extensions password."))
      }
    })
  })
}

function parseArguments(args) {
  const options = { project: DEFAULT_PROJECT, acceptLicense: false, acceptTerms: false }
  for (let index = 0; index < args.length; index += 1) {
    switch (args[index]) {
      case "--zip":
        options.zipPath = args[++index]
        break
      case "--account":
        options.account = args[++index]
        break
      case "--project":
        options.project = args[++index]
        break
      case "--accept-license":
        options.acceptLicense = true
        break
      case "--accept-terms":
        options.acceptTerms = true
        break
      case "--setup":
        options.setup = true
        break
      case "--help":
        options.help = true
        break
      default:
        throw new Error(`Unknown argument: ${args[index]}`)
    }
  }
  return options
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2))
    if (options.help) {
      console.log("Usage: npm run upload:gnome -- --zip <extension.zip> [--account <GNOME login>] [--project <secret project>] --accept-license --accept-terms\n       npm run setup:gnome-secrets [-- --account <GNOME login> --project <secret project>]")
    } else if (options.setup) {
      await configureGnomeUpload(options)
      console.log("GNOME Extensions upload password stored in the desktop keyring.")
    } else {
      await uploadGnomeExtension(options)
      console.log("GNOME Extensions upload accepted for review.")
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
