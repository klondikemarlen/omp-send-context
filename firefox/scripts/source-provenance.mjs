import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"

const execFileAsync = promisify(execFile)
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const SOURCE_COMMIT_PLACEHOLDER = "uncommitted"
const SOURCE_COMMIT_DECLARATION = `const SOURCE_COMMIT = "${SOURCE_COMMIT_PLACEHOLDER}"`

export async function resolveSourceCommit({ cwd = REPO_ROOT, requireClean = false } = {}) {
  let commit
  try {
    commit = (await execFileAsync("git", ["-C", cwd, "rev-parse", "HEAD"])).stdout.trim()
  } catch {
    if (requireClean) {
      throw new Error("Firefox release provenance requires a Git commit.")
    }
    return "unknown"
  }

  if (!/^[0-9a-f]{40}$/i.test(commit)) {
    if (requireClean) {
      throw new Error("Firefox release provenance did not resolve to a full commit SHA.")
    }
    return "unknown"
  }

  let status = ""
  try {
    status = (
      await execFileAsync("git", ["-C", cwd, "status", "--porcelain", "--untracked-files=all"])
    ).stdout
  } catch {
    if (requireClean) {
      throw new Error("Firefox release provenance requires a readable Git worktree.")
    }
    return "unknown"
  }

  if (status.trim() !== "") {
    if (requireClean) {
      throw new Error("Firefox release provenance requires a clean Git worktree.")
    }
    return "uncommitted"
  }

  return commit
}

export async function createFirefoxBuildSource({
  sourceDirectory = resolve(REPO_ROOT, "firefox"),
  cwd = REPO_ROOT,
  requireClean = false,
} = {}) {
  const sourceCommit = await resolveSourceCommit({ cwd, requireClean })
  const temporaryRoot = await mkdtemp(join(tmpdir(), "omp-send-context-firefox-"))
  const temporarySource = join(temporaryRoot, "firefox")
  try {
    await cp(sourceDirectory, temporarySource, { recursive: true })
    const backgroundPath = join(temporarySource, "background.js")
    const backgroundSource = await readFile(backgroundPath, "utf8")
    if (!backgroundSource.includes(SOURCE_COMMIT_DECLARATION)) {
      throw new Error("Firefox background source is missing the source commit placeholder.")
    }
    await writeFile(
      backgroundPath,
      backgroundSource.replace(
        SOURCE_COMMIT_DECLARATION,
        `const SOURCE_COMMIT = "${sourceCommit}"`
      ),
      "utf8"
    )
    return {
      sourceCommit,
      sourceDirectory: temporarySource,
      cleanup: () => rm(temporaryRoot, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true })
    throw error
  }
}
