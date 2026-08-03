(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory()
  } else {
    root.ompSendContext = factory()
  }
})(typeof globalThis === "object" ? globalThis : this, function () {
  const FIREFOX_RESTRICTED_HOSTS = new Set([
    "accounts-static.cdn.mozilla.net",
    "accounts.firefox.com",
    "addons.cdn.mozilla.net",
    "addons.mozilla.org",
    "api.accounts.firefox.com",
    "content.cdn.mozilla.net",
    "discovery.addons.mozilla.org",
    "install.mozilla.org",
    "oauth.accounts.firefox.com",
    "profile.accounts.firefox.com",
    "support.mozilla.org",
    "sync.services.mozilla.com",
  ])
  function isSupportedGithubUrl(value) {
    try {
      const url = new URL(value)
      return url.protocol === "https:" && url.hostname === "github.com" && /^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/.test(url.pathname)
    } catch {
      return false
    }
  }

  function isEligiblePageUrl(value) {
    if (!isHttpUrl(value)) {
      return false
    }
    try {
      const hostname = new URL(value).hostname
      return ![...FIREFOX_RESTRICTED_HOSTS].some(host => hostname === host || hostname.endsWith(`.${host}`))
    } catch {
      return false
    }
  }

  function extractGithubDiffLocation(document, selection) {
    if (!isSupportedGithubUrl(document?.location?.href) || !selection || selection.rangeCount === 0) {
      return undefined
    }
    const range = selection.getRangeAt(0)
    const endpointSides = [selection.anchorNode, selection.focusNode]
      .map(getDiffSide)
      .filter(side => side === "left" || side === "right")
    const singleEndpointSide = endpointSides.length === 2 && endpointSides[0] === endpointSides[1]
      ? endpointSides[0]
      : undefined
    const rows = [...(document.querySelectorAll?.(".blob-code.js-file-line, [data-line-anchor][data-line-number]") ?? [])].filter(node => {
      if (singleEndpointSide !== undefined && getDiffSide(node) !== singleEndpointSide) {
        return false
      }
      try {
        return range.intersectsNode(node)
      } catch {
        return false
      }
    })
    const locations = rows.map(row => {
      const tr = row.closest?.("tr")
      const diffSide = getDiffSide(row)
      const splitSide = row.getAttribute?.("data-split-side")
      const deleted = row.classList?.contains("blob-code-deletion") || row.classList?.contains("deletion") || splitSide == null && row.querySelector?.(".deletion")
      const added = row.classList?.contains("blob-code-addition") || row.classList?.contains("addition") || splitSide == null && row.querySelector?.(".addition")
      const version = diffSide === "left" || deleted ? "original" : diffSide === "right" || added ? "modified" : "both"
      const sideCell = diffSide === "left"
        ? tr?.querySelector?.(".blob-num:not(.js-blob-rnum)[data-line-number]")
        : diffSide === "right"
          ? tr?.querySelector?.(".blob-num.js-blob-rnum[data-line-number]")
          : undefined
      const beforeCell = tr?.querySelector?.(".blob-num-deletion[data-line-number]")
      const afterCell = tr?.querySelector?.(".blob-num-addition[data-line-number]")
      const line = row.getAttribute?.("data-line-number")
        ?? sideCell?.getAttribute("data-line-number")
        ?? (version === "original" ? beforeCell?.getAttribute("data-line-number") : afterCell?.getAttribute("data-line-number"))
        ?? beforeCell?.getAttribute("data-line-number")
        ?? afterCell?.getAttribute("data-line-number")
      const anchor = row.getAttribute?.("data-line-anchor")
        ?? sideCell?.getAttribute("id")
        ?? (version === "original" ? beforeCell?.getAttribute("id") : afterCell?.getAttribute("id"))
      return {
        file: diffFileFromRow(row),
        version,
        change: deleted && added ? "mixed" : deleted ? "removed" : added ? "added" : "context",
        line,
        anchor,
      }
    }).filter(location => typeof location.file === "string" && location.file.length > 0 && Number.isInteger(Number(location.line)))
    if (locations.length === 0) {
      return undefined
    }
    const files = [...new Set(locations.map(location => location.file))]
    if (files.length !== 1) {
      return undefined
    }
    const versions = [...new Set(locations.map(location => location.version))]
    const changes = [...new Set(locations.map(location => location.change))]
    const lines = versions.length === 1
      ? lineRange(locations.map(location => location.line))
      : versions.map(version => `${version} ${lineRange(locations.filter(location => location.version === version).map(location => location.line))}`).join("; ")
    const permalink = buildDiffPermalink(document, locations)
    const headCommit = extractGithubCommit(document)
    return {
      file: files[0],
      version: versions.length === 1 && versions[0] === "both" ? "original and modified" : versions.length === 1 ? versions[0] : "original and modified",
      change: changes.length === 1 ? changes[0] : "mixed",
      ...(lines ? { lines } : {}),
      ...(permalink ? { permalink } : {}),
      ...(headCommit ? { headCommit } : {}),
    }
  }

  function getDiffSide(node) {
    const directSide = node?.getAttribute?.("data-diff-side") ?? node?.getAttribute?.("data-split-side")
    if (directSide != null) {
      return directSide
    }

    const sideElement = node?.closest?.("[data-diff-side], [data-split-side]")
      ?? node?.parentElement?.closest?.("[data-diff-side], [data-split-side]")
    return sideElement?.getAttribute?.("data-diff-side") ?? sideElement?.getAttribute?.("data-split-side")
  }

  function diffFileFromRow(row) {
    const legacyPath = row.closest?.("[data-tagsearch-path]")?.getAttribute("data-tagsearch-path")
    if (legacyPath) {
      return legacyPath
    }
    const label = row.closest?.("table")?.getAttribute?.("aria-label")
    return typeof label === "string" && label.startsWith("Diff for: ") ? label.slice("Diff for: ".length) : undefined
  }

  function extractGithubCommit(document) {
    const headAttributes = [...(document.querySelectorAll?.("[data-head-sha], [data-head-commit-sha], [data-pull-request-head-sha]") ?? [])]
      .flatMap(node => [
        node.getAttribute?.("data-head-sha"),
        node.getAttribute?.("data-head-commit-sha"),
        node.getAttribute?.("data-pull-request-head-sha"),
      ])
    const headCommit = headAttributes.find(value => /^[0-9a-f]{7,40}$/i.test(value ?? ""))
    if (headCommit) {
      return headCommit
    }

    return [...(document.querySelectorAll?.("[data-commit], a[data-commit]") ?? [])]
      .map(node => node.getAttribute?.("data-commit"))
      .find(value => /^[0-9a-f]{7,40}$/i.test(value ?? ""))
  }

  function lineRange(lines) {
    const values = [...new Set(lines.map(Number).filter(Number.isInteger))].sort((a, b) => a - b)
    if (values.length === 0 || values.some((value, index) => index > 0 && value !== values[index - 1] + 1)) {
      return undefined
    }
    return values.length === 1 ? String(values[0]) : `${values[0]}-${values.at(-1)}`
  }

  function buildDiffPermalink(document, locations) {
    const anchors = locations.map(location => location.anchor)
    if (anchors.length === 0 || anchors.some(anchor => typeof anchor !== "string")) {
      return undefined
    }
    const parsed = anchors.map(anchor => /^(.+)([LR])(\d+)$/.exec(anchor))
    const first = parsed[0]
    if (!first || parsed.some(match => !match || match[1] !== first[1] || match[2] !== first[2])) {
      return undefined
    }
    const start = Number(first[3])
    if (parsed.some((match, index) => Number(match[3]) !== start + index)) {
      return undefined
    }
    const end = parsed.at(-1)
    const fragment = anchors.length === 1 ? anchors[0] : `${anchors[0]}-${end[2]}${end[3]}`
    try {
      const url = new URL(document.location.href)
      url.hash = `#${fragment}`
      return url.toString()
    } catch {
      return undefined
    }
  }

  function createEnvelope({ selectionText, linkUrl, pageUrl, title, diffLocation }) {
    if (!isEligiblePageUrl(pageUrl)) {
      throw new Error("OMP Send Context does not support this page.")
    }
    if (typeof selectionText !== "string" || selectionText.trim().length === 0) {
      throw new Error(isSupportedGithubUrl(pageUrl) ? "Select GitHub code before sending context to OMP." : "Select text before sending context to OMP.")
    }

    const github = isSupportedGithubUrl(pageUrl)
    const url = github && isHttpUrl(diffLocation?.permalink) ? diffLocation.permalink : github && isHttpUrl(linkUrl) ? linkUrl : pageUrl
    return {
      version: 1,
      source: "firefox",
      prompt: formatPrompt({ selectionText, url, title, github, diffLocation: github ? diffLocation : undefined }),
      metadata: {
        url,
        ...(typeof title === "string" && title.length > 0 ? { title } : {}),
      },
    }
  }

  function formatPrompt({ selectionText, url, title, github = true, diffLocation }) {
    const sections = ["# OMP Agent Handoff", github ? "## GitHub" : "## Web page"]
    if (typeof title === "string" && title.length > 0) {
      sections.push(`- Title: ${title}`)
    }
    if (github && diffLocation?.file) {
      sections.push(`- File: ${diffLocation.file}`)
      if (diffLocation.version) {
        sections.push(`- Version: ${diffLocation.version}`)
      }
      if (diffLocation.change) {
        sections.push(`- Change: ${diffLocation.change}`)
      }
      if (diffLocation.lines) {
        const readableLines = diffLocation.version === "original and modified"
          ? diffLocation.lines.replace(/(original|modified) ([^;]+)(?=;|$)/g, "$1 file $2")
          : diffLocation.version === "original" || diffLocation.version === "modified"
            ? `${diffLocation.lines} in the ${diffLocation.version} file`
            : diffLocation.lines
        sections.push(`- Lines: ${readableLines}`)
      }
      if (diffLocation.headCommit) {
        sections.push(`- Head commit: ${diffLocation.headCommit}`)
      }
    }
    sections.push(`- Location: ${url}`)
    const fence = codeFence(selectionText)
    sections.push("## Selected text", `${fence}\n${selectionText}\n${fence}`)
    return `${sections.join("\n\n")}\n\n`
  }

  function codeFence(text) {
    let fence = "```"
    while (text.includes(fence)) {
      fence += "`"
    }
    return fence
  }

  function normalizeSelectionText(text) {
    const lines = text.split(/\r\n?|\n/)
    const leadingBlank = lines[0]?.trim() === ""
    const trailingBlank = lines.at(-1)?.trim() === ""
    const start = leadingBlank ? 1 : 0
    const end = trailingBlank ? lines.length - 1 : lines.length
    const content = lines.slice(start, end)
    if (content.length < 3 || content.length % 2 === 0) {
      return text
    }
    for (let index = 0; index < content.length; index += 1) {
      if (index % 2 === 0 ? content[index].trim() === "" : content[index].trim() !== "") {
        return text
      }
    }
    return [...(leadingBlank ? [""] : []), ...content.filter((_, index) => index % 2 === 0), ...(trailingBlank ? [""] : [])].join("\n")
  }

  function isHttpUrl(value) {
    try {
      const url = new URL(value)
      return url.protocol === "https:" || url.protocol === "http:"
    } catch {
      return false
    }
  }

  return {
    createEnvelope,
    formatPrompt,
    normalizeSelectionText,
    isEligiblePageUrl,
    isSupportedGithubUrl,
    extractGithubDiffLocation,
  }
})
