import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import vm from "node:vm"

const contextSource = await fs.readFile(new URL("../firefox/context.js", import.meta.url), "utf8")
const manifest = JSON.parse(await fs.readFile(new URL("../firefox/manifest.json", import.meta.url), "utf8"))
const firefoxPackage = JSON.parse(await fs.readFile(new URL("../firefox/package.json", import.meta.url), "utf8"))
const context = { URL }
vm.runInNewContext(contextSource, context)
const { createEnvelope, formatPrompt, isEligiblePageUrl, isSupportedGithubUrl } = context.ompSendContext

test("Firefox client recognizes GitHub pull-request pages", () => {
  assert.equal(isSupportedGithubUrl("https://github.com/org/repo/pull/42/files"), true)
  assert.equal(isSupportedGithubUrl("https://github.com/org/repo/issues/42"), false)
  assert.equal(isSupportedGithubUrl("https://evil.example/github.com/org/repo/pull/42"), false)
})

test("Firefox manifest keeps generic capture on click-time activeTab access", () => {
  assert.ok(manifest.permissions.includes("activeTab"))
  assert.equal(manifest.permissions.some(permission => permission.includes("*://")), false)
  assert.equal(manifest.permissions.includes("storage"), false)
  assert.equal(manifest.content_scripts, undefined)
})

test("Firefox client recognizes eligible web pages", () => {
  assert.equal(isEligiblePageUrl("https://example.com/article"), true)
  assert.equal(isEligiblePageUrl("http://localhost:3000/"), true)
  assert.equal(isEligiblePageUrl("about:blank"), false)
  assert.equal(isEligiblePageUrl("file:///tmp/example.html"), false)
})

test("Firefox manifest declares branded icons and supported desktop metadata", async () => {
  assert.equal(manifest.browser_specific_settings.gecko.strict_min_version_android, undefined)
  assert.deepEqual(manifest.icons, {
    "48": "icons/icon-48.png",
    "96": "icons/icon-96.png",
    "128": "icons/icon-128.png",
  })
  assert.deepEqual(manifest.browser_action.default_icon, manifest.icons)
  assert.equal(manifest.browser_action.default_popup, "popup.html")
  for (const iconSize of ["48", "96", "128"]) {
    const bytes = await fs.readFile(new URL(`../firefox/icons/icon-debug-${iconSize}.png`, import.meta.url))
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  }
  assert.equal(firefoxPackage.version, manifest.version)
  for (const iconPath of Object.values(manifest.icons)) {
    const bytes = await fs.readFile(new URL(`../firefox/${iconPath}`, import.meta.url))
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  }
})

test("Firefox client creates a protocol v1 envelope with permalink metadata", () => {
  const envelope = createEnvelope({
    selectionText: "return db.transaction(async () => {})",
    linkUrl: "https://github.com/org/repo/pull/42/files#diff-abcR53",
    pageUrl: "https://github.com/org/repo/pull/42/files",
    title: "Add transactions",
  })

  assert.deepEqual(JSON.parse(JSON.stringify(envelope)), {
    version: 1,
    source: "firefox",
    prompt: "# OMP Agent Handoff\n\n## GitHub\n\n- Title: Add transactions\n\n- Location: https://github.com/org/repo/pull/42/files#diff-abcR53\n\n## Selected text\n\n```\nreturn db.transaction(async () => {})\n```\n\n",
    metadata: {
      url: "https://github.com/org/repo/pull/42/files#diff-abcR53",
      title: "Add transactions",
    },
  })
})

test("Firefox client creates a generic web-page envelope with page metadata", () => {
  const envelope = createEnvelope({
    selectionText: "const value = 1",
    linkUrl: "https://example.com/other",
    pageUrl: "https://example.com/article",
    title: "An article",
  })

  assert.deepEqual(JSON.parse(JSON.stringify(envelope)), {
    version: 1,
    source: "firefox",
    prompt: "# OMP Agent Handoff\n\n## Web page\n\n- Title: An article\n\n- Location: https://example.com/article\n\n## Selected text\n\n```\nconst value = 1\n```\n\n",
    metadata: {
      url: "https://example.com/article",
      title: "An article",
    },
  })
})

test("Firefox client lengthens fences and falls back to the page URL", () => {
  const selection = "```js\nconst value = 1\n```"
  assert.equal(formatPrompt({
    selectionText: selection,
    url: "https://github.com/org/repo/pull/42",
  }), "# OMP Agent Handoff\n\n## GitHub\n\n- Location: https://github.com/org/repo/pull/42\n\n## Selected text\n\n````\n```js\nconst value = 1\n```\n````\n\n")

test("Firefox prompt leaves follow-up text outside the selection fence", () => {
  const prompt = formatPrompt({
    selectionText: "selected text",
    url: "https://example.com/article",
    github: false,
  })

  assert.equal(prompt.endsWith("```\n\n"), true)
  assert.equal(`${prompt}that seemed to work?`.includes("```\n\nthat seemed to work?"), true)
})

  const envelope = createEnvelope({
    selectionText: "const value = 1",
    linkUrl: "not-a-url",
    pageUrl: "https://github.com/org/repo/pull/42",
  })
  assert.equal(envelope.metadata.url, "https://github.com/org/repo/pull/42")
})

test("Firefox client rejects empty selection and unsupported pages", () => {
  assert.throws(() => createEnvelope({
    selectionText: "",
    pageUrl: "https://github.com/org/repo/pull/42",
  }), /Select GitHub code/)
  assert.throws(() => createEnvelope({
    selectionText: "const value = 1",
    pageUrl: "about:blank",
  }), /does not support this page/)
})
