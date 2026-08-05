import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { configureGnomeUpload, uploadGnomeExtension } from "../upload-gnome.mjs"

async function withZip(run) {
  const directory = await mkdtemp(join(tmpdir(), "omp-gnome-upload-"))
  const zipPath = join(directory, "extension.zip")
  await writeFile(zipPath, "zip payload")
  try {
    await run(zipPath)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function uploadOptions(zipPath, fetchImpl) {
  return {
    zipPath,
    account: "maintainer@example.com",
    acceptLicense: true,
    acceptTerms: true,
    fetchImpl,
    lookupSecret: async (attributes) => {
      assert.deepEqual(attributes, {
        service: "extensions.gnome.org",
        project: "omp-send-context",
        account: "maintainer@example.com",
        purpose: "upload",
      })
      return "keyring password"
    },
  }
}

function loginPage() {
  return new Response('<input name="csrfmiddlewaretoken" value="initial-csrf">', {
    status: 200,
    headers: { "Set-Cookie": "csrftoken=initial-csrf; Path=/" },
  })
}

test("GNOME secret setup prompts for and stores the account", async () => {
  const stored = []
  await configureGnomeUpload({
    prompt: async () => "maintainer@example.com",
    storeSecret: async (attributes) => stored.push(attributes),
  })
  assert.deepEqual(stored, [
    {
      label: "GNOME Extensions upload password",
      service: "extensions.gnome.org",
      project: "omp-send-context",
      account: "maintainer@example.com",
      purpose: "upload",
    },
  ])
})

test("GNOME uploader prompts for an omitted account", async () => {
  await withZip(async (zipPath) => {
    let requests = 0
    await uploadGnomeExtension({
      zipPath,
      acceptLicense: true,
      acceptTerms: true,
      prompt: async () => "maintainer@example.com",
      lookupSecret: async ({ account }) => {
        assert.equal(account, "maintainer@example.com")
        return "keyring password"
      },
      fetchImpl: async (_url, options) => {
        if (requests++ === 0) return loginPage()
        if (requests === 2) {
          assert.deepEqual(
            [...options.body],
            [
              ["username", "maintainer@example.com"],
              ["password", "keyring password"],
              ["csrfmiddlewaretoken", "initial-csrf"],
            ]
          )
          return new Response(null, {
            status: 302,
            headers: { "Set-Cookie": "sessionid=opaque-session; HttpOnly" },
          })
        }
        return new Response(null, { status: 201 })
      },
    })
  })
})

test("GNOME uploader logs in through the web form and submits the required ZIP fields", async () => {
  await withZip(async (zipPath) => {
    const calls = []
    await uploadGnomeExtension(
      uploadOptions(zipPath, async (url, options) => {
        calls.push({ url, options })
        if (calls.length === 1) {
          assert.equal(url, "https://extensions.gnome.org/accounts/login/")
          return loginPage()
        }
        if (calls.length === 2) {
          assert.equal(url, "https://extensions.gnome.org/accounts/login/")
          assert.equal(options.method, "POST")
          assert.equal(options.redirect, "manual")
          assert.equal(options.headers.Cookie, "csrftoken=initial-csrf")
          assert.equal(options.headers.Referer, "https://extensions.gnome.org/accounts/login/")
          assert.deepEqual(
            [...options.body],
            [
              ["username", "maintainer@example.com"],
              ["password", "keyring password"],
              ["csrfmiddlewaretoken", "initial-csrf"],
            ]
          )
          return new Response(null, {
            status: 302,
            headers: { "Set-Cookie": "sessionid=opaque-session; HttpOnly; Path=/" },
          })
        }

        assert.equal(url, "https://extensions.gnome.org/api/v1/extensions")
        assert.equal(options.method, "POST")
        assert.equal(options.headers.Cookie, "csrftoken=initial-csrf; sessionid=opaque-session")
        assert.equal(options.headers["X-CSRFToken"], "initial-csrf")
        assert.equal(options.headers.Origin, "https://extensions.gnome.org")
        assert.equal(options.headers.Referer, "https://extensions.gnome.org/upload/")
        assert.equal(options.body.get("shell_license_compliant"), "true")
        assert.equal(options.body.get("tos_compliant"), "true")
        const source = options.body.get("source")
        assert.equal(source.name, "extension.zip")
        assert.equal(await source.text(), "zip payload")
        return new Response("{}", { status: 201 })
      })
    )
    assert.equal(calls.length, 3)
  })
})

test("GNOME uploader rejects unacknowledged agreements, failed login, and failed uploads", async () => {
  await assert.rejects(
    uploadGnomeExtension({ zipPath: "extension.zip", account: "maintainer@example.com" }),
    /--accept-license and --accept-terms/
  )

  await withZip(async (zipPath) => {
    await assert.rejects(
      uploadGnomeExtension(
        uploadOptions(zipPath, async (_url, options) =>
          options?.method ? new Response(null, { status: 302 }) : loginPage()
        )
      ),
      /did not return a session cookie/
    )

    let requests = 0
    await assert.rejects(
      uploadGnomeExtension(
        uploadOptions(zipPath, async (_url, options) => {
          if (requests++ === 0) return loginPage()
          if (options?.method === "POST" && requests === 2) {
            return new Response(null, {
              status: 302,
              headers: { "Set-Cookie": "sessionid=opaque-session" },
            })
          }
          return new Response(null, { status: 400 })
        })
      ),
      /upload failed \(400\)/
    )
  })
})
