import test from "node:test"
import assert from "node:assert/strict"
import JSZip from "jszip"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { promisify } from "node:util"
import { delimiter, join } from "node:path"
import { tmpdir } from "node:os"

import {
  createFirefoxBuildSource,
  resolveSourceCommit,
} from "../../firefox/scripts/source-provenance.mjs"

const execFileAsync = promisify(execFile)

const firefoxArtifactsDirectory = join(tmpdir(), "omp-send-context-firefox")

async function git(cwd, ...args) {
  await execFileAsync("git", ["-C", cwd, ...args])
}

async function temporaryGitSource() {
  const root = await mkdtemp(join(tmpdir(), "omp-send-context-provenance-test-"))
  const sourceDirectory = join(root, "firefox")
  await mkdir(sourceDirectory)
  await writeFile(
    join(sourceDirectory, "background.js"),
    'const SOURCE_COMMIT = "uncommitted"\n',
    "utf8"
  )
  await git(root, "init", "--quiet")
  await git(root, "config", "user.email", "test@example.com")
  await git(root, "config", "user.name", "OMP test")
  await git(root, "add", ".")
  await git(root, "commit", "--quiet", "-m", "initial")
  return { root, sourceDirectory }
}

test("Firefox build staging injects the full clean source commit", async () => {
  const { root, sourceDirectory } = await temporaryGitSource()
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"])
    const commit = stdout.trim()
    assert.match(commit, /^[0-9a-f]{40}$/)
    assert.equal(await resolveSourceCommit({ cwd: root, requireClean: true }), commit)

    const staged = await createFirefoxBuildSource({
      sourceDirectory,
      cwd: root,
      requireClean: true,
    })
    try {
      assert.equal(staged.sourceCommit, commit)
      assert.equal(
        await readFile(join(staged.sourceDirectory, "background.js"), "utf8"),
        `const SOURCE_COMMIT = "${commit}"\n`
      )
    } finally {
      await staged.cleanup()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("Firefox development staging labels dirty and non-Git sources explicitly", async () => {
  const { root, sourceDirectory } = await temporaryGitSource()
  try {
    await writeFile(
      join(sourceDirectory, "background.js"),
      'const SOURCE_COMMIT = "uncommitted"\n// local edit\n',
      "utf8"
    )
    assert.equal(await resolveSourceCommit({ cwd: root }), "uncommitted")
    await assert.rejects(
      resolveSourceCommit({ cwd: root, requireClean: true }),
      /clean Git worktree/
    )

    const staged = await createFirefoxBuildSource({ sourceDirectory, cwd: root })
    try {
      assert.equal(staged.sourceCommit, "uncommitted")
      assert.match(
        await readFile(join(staged.sourceDirectory, "background.js"), "utf8"),
        /const SOURCE_COMMIT = "uncommitted"/
      )
    } finally {
      await staged.cleanup()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }

  const nonGitRoot = await mkdtemp(join(tmpdir(), "omp-send-context-non-git-test-"))
  try {
    assert.equal(await resolveSourceCommit({ cwd: nonGitRoot }), "unknown")
  } finally {
    await rm(nonGitRoot, { recursive: true, force: true })
  }
})

test("Firefox package embeds the resolved source commit in the artifact", async () => {
  const expectedCommit = await resolveSourceCommit()
  const binDirectory = join(process.cwd(), "node_modules", ".bin")
  await execFileAsync(process.execPath, ["firefox/scripts/package-firefox.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PATH: [binDirectory, process.env.PATH].filter(Boolean).join(delimiter) },
  })
  const artifacts = (await readdir(firefoxArtifactsDirectory)).filter((name) =>
    name.endsWith(".zip")
  )
  assert.equal(artifacts.length, 1)

  const zip = await JSZip.loadAsync(await readFile(join(firefoxArtifactsDirectory, artifacts[0])))
  const background = await zip.file("background.js").async("string")
  assert.match(background, new RegExp(`const SOURCE_COMMIT = "${expectedCommit}"`))
  assert.match(background, /Source commit:/)
})

test("Firefox signing stages artifacts outside the checkout", async () => {
  const binDirectory = await mkdtemp(join(tmpdir(), "omp-send-context-web-ext-test-"))
  const argumentsFile = join(binDirectory, "arguments.json")
  try {
    await writeFile(
      join(binDirectory, "web-ext"),
      `#!/usr/bin/env node
import { writeFileSync } from "node:fs"
writeFileSync(process.env.WEB_EXT_ARGUMENTS_FILE, JSON.stringify(process.argv.slice(2)))
`,
      { mode: 0o755 }
    )
    await execFileAsync(process.execPath, ["firefox/scripts/sign-firefox.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AMO_API_ISSUER: "test-issuer",
        AMO_API_SECRET: "test-secret",
        PATH: [binDirectory, process.env.PATH].filter(Boolean).join(delimiter),
        WEB_EXT_ARGUMENTS_FILE: argumentsFile,
      },
    })
    const args = JSON.parse(await readFile(argumentsFile, "utf8"))
    assert.equal(args[args.indexOf("--artifacts-dir") + 1], firefoxArtifactsDirectory)
  } finally {
    await rm(binDirectory, { recursive: true, force: true })
  }
})
