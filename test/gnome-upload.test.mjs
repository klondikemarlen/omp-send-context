import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { uploadGnomeExtension } from "../upload-gnome.mjs"

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
    lookupSecret: async attributes => {
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

test("GNOME uploader logs in from Secret Service and submits the required ZIP fields", async () => {
  await withZip(async zipPath => {
    const calls = []
    await uploadGnomeExtension(uploadOptions(zipPath, async (url, options) => {
      calls.push({ url, options })
      if (calls.length === 1) {
        assert.equal(url, "https://extensions.gnome.org/api/v1/accounts/login/")
        assert.equal(options.method, "POST")
        assert.deepEqual([...options.body], [["login", "maintainer@example.com"], ["password", "keyring password"]])
        return new Response(null, {
          status: 200,
          headers: [
            ["Set-Cookie", "sessionid=opaque-session; HttpOnly; Path=/"],
            ["Set-Cookie", "csrftoken=opaque-csrf; Path=/"],
          ],
        })
      }

      assert.equal(url, "https://extensions.gnome.org/api/v1/extensions")
      assert.equal(options.method, "POST")
      assert.equal(options.headers.Cookie, "sessionid=opaque-session; csrftoken=opaque-csrf")
      assert.equal(options.headers["X-CSRFToken"], "opaque-csrf")
      assert.equal(options.body.get("shell_license_compliant"), "true")
      assert.equal(options.body.get("tos_compliant"), "true")
      const source = options.body.get("source")
      assert.equal(source.name, "extension.zip")
      assert.equal(await source.text(), "zip payload")
      return new Response("{}", { status: 201 })
    }))
    assert.equal(calls.length, 2)
  })
})

test("GNOME uploader rejects unacknowledged agreements, missing sessions, and failed uploads", async () => {
  await assert.rejects(
    uploadGnomeExtension({ zipPath: "extension.zip", account: "maintainer@example.com" }),
    /--accept-license and --accept-terms/,
  )

  await withZip(async zipPath => {
    await assert.rejects(
      uploadGnomeExtension(uploadOptions(zipPath, async () => new Response(null, { status: 200 }))),
      /did not return a session cookie/,
    )

    await assert.rejects(
      uploadGnomeExtension(uploadOptions(zipPath, async url => {
        if (url.endsWith("/login/")) {
          return new Response(null, { status: 200, headers: { "Set-Cookie": "sessionid=opaque-session; HttpOnly" } })
        }
        return new Response(null, { status: 400 })
      })),
      /upload failed \(400\)/,
    )
  })
})
