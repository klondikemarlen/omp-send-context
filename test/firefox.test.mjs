import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import vm from "node:vm"

const contextSource = await fs.readFile(new URL("../firefox/context.js", import.meta.url), "utf8")
const backgroundSource = await fs.readFile(new URL("../firefox/background.js", import.meta.url), "utf8")
const contentSource = await fs.readFile(new URL("../firefox/content.js", import.meta.url), "utf8")
const manifest = JSON.parse(await fs.readFile(new URL("../firefox/manifest.json", import.meta.url), "utf8"))
const firefoxPackage = JSON.parse(await fs.readFile(new URL("../firefox/package.json", import.meta.url), "utf8"))
const context = { URL }
vm.runInNewContext(contextSource, context)
const { createEnvelope, extractGithubDiffLocation, formatPrompt, isEligiblePageUrl, isSupportedGithubUrl } = context.ompSendContext

test("Firefox client recognizes GitHub pull-request pages", () => {
  assert.equal(isSupportedGithubUrl("https://github.com/org/repo/pull/42/files"), true)
  assert.equal(isSupportedGithubUrl("https://github.com/org/repo/issues/42"), false)
  assert.equal(isSupportedGithubUrl("https://evil.example/github.com/org/repo/pull/42"), false)
})

test("Firefox manifest requests HTTP(S) access without local-file access", () => {
  assert.equal(manifest.permissions.includes("http://*/*"), true)
  assert.equal(manifest.permissions.includes("https://*/*"), true)
  assert.equal(manifest.permissions.includes("<all_urls>"), false)
  assert.equal(manifest.permissions.includes("activeTab"), false)
  assert.equal(manifest.permissions.includes("storage"), false)
  assert.deepEqual(manifest.content_scripts, [{
    matches: ["http://*/*", "https://*/*"],
    js: ["context.js", "content.js"],
    run_at: "document_idle",
  }])
  assert.match(backgroundSource, /capture:host-access:/)
  assert.match(backgroundSource, /capture:inject-failed:/)
})

test("Firefox client recognizes eligible web pages", () => {
  assert.equal(isEligiblePageUrl("https://example.com/article"), true)
  assert.equal(isEligiblePageUrl("http://localhost:3000/"), true)
  assert.equal(isEligiblePageUrl("https://addons.mozilla.org/en-CA/firefox/addon/omp-send-context/"), false)
  assert.equal(isEligiblePageUrl("https://subdomain.addons.mozilla.org/"), false)
  assert.equal(isEligiblePageUrl("https://support.mozilla.org/en-US/"), false)
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

test("Firefox extracts GitHub diff file, side, and contiguous lines", () => {
  const makeRow = (line, side) => {
    const code = {
      classList: { contains: name => name === "blob-code-" + (side === "after" ? "addition" : "deletion") },
      closest: selector => selector === "[data-tagsearch-path]" ? { getAttribute: () => "src/example.ts" } : tr,
      selected: true,
    }
    const tr = {
      querySelector: selector => ({
        getAttribute: name => name === "data-line-number" && selector.includes("addition") ? String(line) : undefined,
      }),
    }
    return code
  }
  const rows = [makeRow(124, "after"), makeRow(125, "after")]
  const location = extractGithubDiffLocation({
    location: { href: "https://github.com/org/repo/pull/42/files" },
    querySelectorAll: selector => {
      if (selector.includes("data-head-sha") || selector.includes("data-commit")) return []
      assert.equal(selector, ".blob-code.js-file-line, [data-line-anchor][data-line-number]")
      return rows
    },
  }, {
    rangeCount: 1,
    getRangeAt: () => ({ intersectsNode: node => node.selected }),
  })
  assert.deepEqual(JSON.parse(JSON.stringify(location)), { file: "src/example.ts", version: "modified", change: "added", lines: "124-125" })
  assert.match(createEnvelope({
    selectionText: "const value = 1",
    pageUrl: "https://github.com/org/repo/pull/42/files",
    diffLocation: location,
  }).prompt, /- File: src\/example\.ts\n\n- Version: modified\n\n- Change: added\n\n- Lines: 124-125/)
})

test("Firefox builds exact GitHub diff permalinks for both sides", () => {
  const makeLocation = (side, line) => {
    const cell = {
      getAttribute: name => name === "data-line-number" ? String(line) : `diff-c4ff09aa6de01afd7b040b9c957c2c1de47a029f70e3bade00120be8caa8daf1${side === "after" ? "R" : "L"}${line}`,
    }
    const code = {
      classList: { contains: name => name === `blob-code-${side === "after" ? "addition" : "deletion"}` },
      closest: selector => selector === "[data-tagsearch-path]"
        ? { getAttribute: () => "web/src/components/dashboards/DashboardTitleRow.vue" }
        : { querySelector: query => query.includes(side === "after" ? "addition" : "deletion") ? cell : undefined },
    }
    return extractGithubDiffLocation({
      location: { href: "https://github.com/icefoganalytics/wrap/pull/490/changes" },
      querySelectorAll: selector => {
        if (selector.includes("data-head-sha") || selector.includes("data-commit")) return []
        assert.equal(selector, ".blob-code.js-file-line, [data-line-anchor][data-line-number]")
        return [code]
      },
    }, { rangeCount: 1, getRangeAt: () => ({ intersectsNode: () => true }) })
  }
  const after = makeLocation("after", 8)
  const before = makeLocation("before", 8)
  assert.equal(after.permalink, "https://github.com/icefoganalytics/wrap/pull/490/changes#diff-c4ff09aa6de01afd7b040b9c957c2c1de47a029f70e3bade00120be8caa8daf1R8")
  assert.equal(before.permalink, "https://github.com/icefoganalytics/wrap/pull/490/changes#diff-c4ff09aa6de01afd7b040b9c957c2c1de47a029f70e3bade00120be8caa8daf1L8")
  assert.match(createEnvelope({
    selectionText: "selected after code",
    pageUrl: "https://github.com/icefoganalytics/wrap/pull/490/changes",
    diffLocation: after,
  }).prompt, /- Location: https:\/\/github\.com\/icefoganalytics\/wrap\/pull\/490\/changes#diff-.*R8/)
})

test("Firefox builds a GitHub diff range permalink for contiguous same-side selections", () => {
  const lines = [8, 9]
  const rows = lines.map(line => {
    const cell = {
      getAttribute: name => name === "data-line-number"
        ? String(line)
        : `diff-c4ff09aa6de01afd7b040b9c957c2c1de47a029f70e3bade00120be8caa8daf1R${line}`,
    }
    return {
      classList: { contains: name => name === "blob-code-addition" },
      closest: selector => selector === "[data-tagsearch-path]"
        ? { getAttribute: () => "src/example.ts" }
        : { querySelector: query => query.includes("addition") ? cell : undefined },
    }
  })
  const location = extractGithubDiffLocation({
    location: { href: "https://github.com/org/repo/pull/42/files" },
    querySelectorAll: () => rows,
  }, { rangeCount: 1, getRangeAt: () => ({ intersectsNode: () => true }) })
  assert.equal(location.permalink, "https://github.com/org/repo/pull/42/files#diff-c4ff09aa6de01afd7b040b9c957c2c1de47a029f70e3bade00120be8caa8daf1R8-R9")
})

test("Firefox extracts human-readable metadata from the current GitHub diff DOM", () => {
  const rows = [8, 9].map(line => ({
    classList: { contains: () => false },
    getAttribute: name => ({
      "data-diff-side": "right",
      "data-line-number": String(line),
      "data-line-anchor": `diff-c4ff09aa6de01afd7b040b9c957c2c1de47a029f70e3bade00120be8caa8daf1R${line}`,
    }[name]),
    closest: selector => selector === "table"
      ? { getAttribute: name => name === "aria-label" ? "Diff for: web/src/components/dashboards/DashboardTitleRow.vue" : undefined }
      : undefined,
    querySelector: () => undefined,
  }))
  const document = {
    location: { href: "https://github.com/icefoganalytics/wrap/pull/490/changes" },
    querySelectorAll: selector => selector.includes("data-head-sha")
      ? [{ getAttribute: name => name === "data-head-sha" ? "0123456789abcdef0123456789abcdef01234567" : name === "data-commit" ? "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" : undefined }]
      : rows,
  }
  const location = extractGithubDiffLocation(document, { rangeCount: 1, getRangeAt: () => ({ intersectsNode: () => true }) })
  assert.deepEqual(JSON.parse(JSON.stringify(location)), {
    file: "web/src/components/dashboards/DashboardTitleRow.vue",
    version: "modified",
    change: "context",
    lines: "8-9",
    permalink: "https://github.com/icefoganalytics/wrap/pull/490/changes#diff-c4ff09aa6de01afd7b040b9c957c2c1de47a029f70e3bade00120be8caa8daf1R8-R9",
    headCommit: "0123456789abcdef0123456789abcdef01234567",
  })
  assert.match(formatPrompt({
    selectionText: "selected code",
    url: location.permalink,
    title: "WRAPX-270",
    diffLocation: location,
  }), /- File: web\/src\/components\/dashboards\/DashboardTitleRow\.vue\n\n- Version: modified\n\n- Change: context\n\n- Lines: 8-9\n\n- Head commit: 0123456789abcdef0123456789abcdef01234567/)
})

test("Firefox reads the PR head SHA from GitHub commit metadata", () => {
  const row = {
    classList: { contains: () => false },
    getAttribute: name => ({
      "data-diff-side": "right",
      "data-line-number": "8",
      "data-line-anchor": "diff-c4ff09aa6de01afd7b040b9c957c2c1de47a029f70e3bade00120be8caa8daf1R8",
    }[name]),
    closest: selector => selector === "table"
      ? { getAttribute: name => name === "aria-label" ? "Diff for: web/src/components/dashboards/DashboardTitleRow.vue" : undefined }
      : undefined,
    querySelector: () => undefined,
  }
  const headCommit = "4d47355f3e1b797084b568725b809a6231e2fd2a"
  const document = {
    location: { href: "https://github.com/icefoganalytics/wrap/pull/490/changes" },
    querySelectorAll: selector => selector.includes("data-head-sha")
      ? []
      : selector.includes("data-commit")
        ? [{ getAttribute: name => name === "data-commit" ? headCommit : undefined }]
        : [row],
  }
  const location = extractGithubDiffLocation(document, { rangeCount: 1, getRangeAt: () => ({ intersectsNode: () => true }) })
  assert.equal(location.headCommit, headCommit)
})

test("Firefox keeps an original-only selection on the original side", () => {
  const rows = [8, 9, 10, 11, 12, 13, 14, 15, 16].map(line => ["left", line]).concat([8, 9, 10, 11, 12, 13, 14, 15].map(line => ["right", line])).map(([side, line]) => ({
    classList: { contains: () => false },
    getAttribute: name => ({
      "data-diff-side": side,
      "data-line-number": String(line),
      "data-line-anchor": `diff-c4ff09aa6de01afd7b040b9c957c2c1de47a029f70e3bade00120be8caa8daf1${side === "left" ? "L" : "R"}${line}`,
    }[name]),
    closest: selector => selector === "table"
      ? { getAttribute: name => name === "aria-label" ? "Diff for: web/src/components/dashboards/DashboardTitleRow.vue" : undefined }
      : undefined,
    querySelector: () => undefined,
  }))
  const leftCell = { getAttribute: () => "left" }
  const document = {
    location: { href: "https://github.com/icefoganalytics/wrap/pull/490/changes" },
    querySelectorAll: selector => selector.includes("data-head-sha") || selector.includes("data-commit") ? [] : rows,
  }
  const selection = {
    rangeCount: 1,
    anchorNode: { parentElement: { closest: () => leftCell } },
    focusNode: { parentElement: { closest: () => leftCell } },
    getRangeAt: () => ({ intersectsNode: () => true }),
  }
  const location = extractGithubDiffLocation(document, selection)
  assert.deepEqual(JSON.parse(JSON.stringify(location)), {
    file: "web/src/components/dashboards/DashboardTitleRow.vue",
    version: "original",
    change: "context",
    lines: "8-16",
    permalink: "https://github.com/icefoganalytics/wrap/pull/490/changes#diff-c4ff09aa6de01afd7b040b9c957c2c1de47a029f70e3bade00120be8caa8daf1L8-L16",
  })
})

test("Firefox extracts original-side metadata from GitHub split diff cells", () => {
  const rows = [8, 9, 10, 11, 12, 13, 14, 15, 16].map(line => ["left", line]).concat([8, 9, 10, 11, 12, 13, 14, 15].map(line => ["right", line])).map(([side, line]) => {
    const leftCell = { getAttribute: name => name === "data-line-number" ? String(line) : `diff-c4ff09aa6de01afd7b040b9c957c2c1de47a029f70e3bade00120be8caa8daf1L${line}` }
    const rightCell = { getAttribute: name => name === "data-line-number" ? String(line) : `diff-c4ff09aa6de01afd7b040b9c957c2c1de47a029f70e3bade00120be8caa8daf1R${line}` }
    const row = {
      getAttribute: name => name === "data-split-side" ? side : undefined,
      classList: { contains: () => false },
      closest: selector => selector === "tr"
        ? { querySelector: query => query.includes(":not") ? leftCell : query.includes("js-blob-rnum") ? rightCell : undefined }
        : selector === "[data-tagsearch-path]"
          ? { getAttribute: () => "web/src/components/dashboards/DashboardTitleRow.vue" }
          : undefined,
      querySelector: () => undefined,
    }
    return row
  })
  const document = {
    location: { href: "https://github.com/icefoganalytics/wrap/pull/490/changes" },
    querySelectorAll: selector => selector.includes("data-head-sha") || selector.includes("data-commit") ? [] : rows,
  }
  const leftCell = { getAttribute: () => "left" }
  const location = extractGithubDiffLocation(document, {
    rangeCount: 1,
    anchorNode: { parentElement: { closest: () => leftCell } },
    focusNode: { parentElement: { closest: () => leftCell } },
    getRangeAt: () => ({ intersectsNode: () => true }),
  })
  assert.deepEqual(JSON.parse(JSON.stringify(location)), {
    file: "web/src/components/dashboards/DashboardTitleRow.vue",
    version: "original",
    change: "context",
    lines: "8-16",
    permalink: "https://github.com/icefoganalytics/wrap/pull/490/changes#diff-c4ff09aa6de01afd7b040b9c957c2c1de47a029f70e3bade00120be8caa8daf1L8-L16",
  })
})

test("Firefox classifies a split row from the selected side", () => {
  const makeRow = (side, change) => {
    const leftCell = { getAttribute: name => name === "data-line-number" ? "8" : "diff-fileL8" }
    const rightCell = { getAttribute: name => name === "data-line-number" ? "8" : "diff-fileR8" }
    return {
      getAttribute: name => name === "data-split-side" ? side : undefined,
      classList: { contains: name => name === `blob-code-${change}` },
      closest: selector => selector === "tr"
        ? { querySelector: query => query.includes(":not") ? leftCell : rightCell }
        : selector === "[data-tagsearch-path]"
          ? { getAttribute: () => "src/example.ts" }
          : undefined,
      querySelector: selector => selector === ".deletion" || selector === ".addition" ? {} : undefined,
    }
  }
  const rows = [makeRow("left", "deletion"), makeRow("right", "addition")]
  const document = {
    location: { href: "https://github.com/org/repo/pull/42/files?diff=split" },
    querySelectorAll: selector => selector.includes("data-head-sha") || selector.includes("data-commit") ? [] : rows,
  }
  const leftCell = { getAttribute: () => "left" }
  const location = extractGithubDiffLocation(document, {
    rangeCount: 1,
    anchorNode: { parentElement: { closest: () => leftCell } },
    focusNode: { parentElement: { closest: () => leftCell } },
    getRangeAt: () => ({ intersectsNode: () => true }),
  })
  assert.deepEqual(JSON.parse(JSON.stringify(location)), {
    file: "src/example.ts",
    version: "original",
    change: "removed",
    lines: "8",
    permalink: "https://github.com/org/repo/pull/42/files?diff=split#diff-fileL8",
  })
})

test("Firefox reports mixed original and modified selections explicitly", () => {
  const makeRow = (side, change) => ({
    classList: { contains: () => false },
    getAttribute: name => ({
      "data-diff-side": side,
      "data-line-number": "8",
      "data-line-anchor": `diff-c4ff09aa8daf1${side === "left" ? "L" : "R"}8`,
    }[name]),
    closest: selector => selector === "table"
      ? { getAttribute: name => name === "aria-label" ? "Diff for: src/example.ts" : undefined }
      : undefined,
    querySelector: selector => selector === `.${change}` ? {} : undefined,
  })
  const rows = [makeRow("left", "deletion"), makeRow("right", "addition")]
  const document = {
    location: { href: "https://github.com/org/repo/pull/42/files" },
    querySelectorAll: selector => selector.includes("data-head-sha") || selector.includes("data-commit") ? [] : rows,
  }
  const leftCell = { getAttribute: () => "left" }
  const rightCell = { getAttribute: () => "right" }
  const location = extractGithubDiffLocation(document, {
    rangeCount: 1,
    anchorNode: { parentElement: { closest: () => leftCell } },
    focusNode: { parentElement: { closest: () => rightCell } },
    getRangeAt: () => ({ intersectsNode: () => true }),
  })
  assert.deepEqual(JSON.parse(JSON.stringify(location)), {
    file: "src/example.ts",
    version: "original and modified",
    change: "mixed",
    lines: "original 8; modified 8",
  })
  assert.match(formatPrompt({
    selectionText: "old and new code",
    url: "https://github.com/org/repo/pull/42/files",
    diffLocation: location,
  }), /- Version: original and modified\n\n- Change: mixed\n\n- Lines: original 8; modified 8/)
})

test("Firefox extracts deleted GitHub diff lines as before-side context", () => {
  const code = {
    classList: { contains: name => name === "blob-code-deletion" },
    getAttribute: () => null,
    closest: selector => selector === "[data-tagsearch-path]"
      ? { getAttribute: () => "src/removed.ts" }
      : { querySelector: query => ({ getAttribute: name => name === "data-line-number" && query.includes("deletion") ? "42" : undefined }) },
  }
  const location = extractGithubDiffLocation({
    location: { href: "https://github.com/org/repo/pull/42/files" },
    querySelectorAll: selector => {
      if (selector.includes("data-head-sha") || selector.includes("data-commit")) return []
      assert.equal(selector, ".blob-code.js-file-line, [data-line-anchor][data-line-number]")
      return [code]
    },
  }, { rangeCount: 1, getRangeAt: () => ({ intersectsNode: () => true }) })
  assert.deepEqual(JSON.parse(JSON.stringify(location)), { file: "src/removed.ts", version: "original", change: "removed", lines: "42" })
})

test("Firefox preserves legacy nested markers without a split side", () => {
  const cell = { getAttribute: name => name === "data-line-number" ? "42" : undefined }
  const code = {
    classList: { contains: () => false },
    getAttribute: () => null,
    closest: selector => selector === "[data-tagsearch-path]"
      ? { getAttribute: () => "src/removed.ts" }
      : { querySelector: query => query.includes("deletion") ? cell : undefined },
    querySelector: selector => selector === ".deletion" ? {} : undefined,
  }
  const location = extractGithubDiffLocation({
    location: { href: "https://github.com/org/repo/pull/42/files" },
    querySelectorAll: selector => selector.includes("data-head-sha") || selector.includes("data-commit") ? [] : [code],
  }, { rangeCount: 1, getRangeAt: () => ({ intersectsNode: () => true }) })
  assert.deepEqual(JSON.parse(JSON.stringify(location)), { file: "src/removed.ts", version: "original", change: "removed", lines: "42" })
})

test("Firefox omits non-contiguous GitHub line ranges", () => {
  const makeRow = line => ({
    classList: { contains: name => name === "blob-code-addition" },
    closest: selector => selector === "[data-tagsearch-path]"
      ? { getAttribute: () => "src/example.ts" }
      : { querySelector: query => ({ getAttribute: name => name === "data-line-number" && query.includes("addition") ? String(line) : undefined }) },
  })
  const location = extractGithubDiffLocation({
    location: { href: "https://github.com/org/repo/pull/42/files" },
    querySelectorAll: () => [makeRow(124), makeRow(126)],
  }, { rangeCount: 1, getRangeAt: () => ({ intersectsNode: () => true }) })
  assert.deepEqual(JSON.parse(JSON.stringify(location)), { file: "src/example.ts", version: "modified", change: "added" })
})

test("Firefox omits ambiguous cross-file GitHub diff locations", () => {
  const location = extractGithubDiffLocation({
    location: { href: "https://github.com/org/repo/pull/42/files" },
    querySelectorAll: () => [{
      classList: { contains: () => false },
      closest: selector => selector === "[data-tagsearch-path]" ? { getAttribute: () => "a.ts" } : { querySelector: () => ({ getAttribute: () => "1" }) },
    }, {
      classList: { contains: () => false },
      closest: selector => selector === "[data-tagsearch-path]" ? { getAttribute: () => "b.ts" } : { querySelector: () => ({ getAttribute: () => "2" }) },
    }],
  }, {
    rangeCount: 1,
    getRangeAt: () => ({ intersectsNode: () => true }),
  })
  assert.equal(location, undefined)
})

test("Firefox content capture returns diff location metadata", async () => {
  let listener
  const selection = {
    anchorNode: null,
    toString: () => "const value = 1",
  }
  vm.runInNewContext(contentSource, {
    browser: {
      runtime: {
        onMessage: { addListener: callback => { listener = callback } },
        sendMessage: async () => undefined,
      },
    },
    window: {
      getSelection: () => selection,
      location: { href: "https://github.com/org/repo/pull/42/files" },
    },
    ompSendContext: {
      extractGithubDiffLocation: () => ({ file: "src/example.ts", version: "modified", change: "added", lines: "124" }),
    },
    document: { title: "Test pull request" },
  })
  const capture = await listener({ type: "capture-context" })
  assert.equal(capture.pageUrl, "https://github.com/org/repo/pull/42/files")
  assert.equal(capture.selectionText, "const value = 1")
  assert.deepEqual(capture.diffLocation, { file: "src/example.ts", version: "modified", change: "added", lines: "124" })
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
