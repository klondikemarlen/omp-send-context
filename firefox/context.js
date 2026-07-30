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
    const rows = [...(document.querySelectorAll?.(".blob-code.js-file-line") ?? [])].filter(node => {
      try {
        return range.intersectsNode(node)
      } catch {
        return false
      }
    })
    const locations = rows.map(row => {
      const file = row.closest?.("[data-tagsearch-path]")?.getAttribute("data-tagsearch-path")
      const tr = row.closest?.("tr")
      const before = tr?.querySelector?.(".blob-num-deletion[data-line-number]")?.getAttribute("data-line-number")
      const after = tr?.querySelector?.(".blob-num-addition[data-line-number]")?.getAttribute("data-line-number")
      const side = row.classList?.contains("blob-code-deletion") ? "before" : row.classList?.contains("blob-code-addition") ? "after" : undefined
      return { file, before, after, side }
    }).filter(location => typeof location.file === "string" && (location.before || location.after))
    if (locations.length === 0) {
      return undefined
    }
    const files = [...new Set(locations.map(location => location.file))]
    if (files.length !== 1) {
      return undefined
    }
    const before = locations.filter(location => location.side === "before" || (!location.side && location.before)).map(location => location.before).filter(Boolean)
    const after = locations.filter(location => location.side === "after" || (!location.side && location.after)).map(location => location.after).filter(Boolean)
    const beforeRange = lineRange(before)
    const afterRange = lineRange(after)
    return {
      file: files[0],
      ...(beforeRange ? { before: beforeRange } : {}),
      ...(afterRange ? { after: afterRange } : {}),
      ...(locations.every(location => location.side === "before") ? { side: "before" } : {}),
      ...(locations.every(location => location.side === "after") ? { side: "after" } : {}),
    }
  }

  function lineRange(lines) {
    const values = [...new Set(lines.map(Number).filter(Number.isInteger))].sort((a, b) => a - b)
    if (values.length === 0 || values.some((value, index) => index > 0 && value !== values[index - 1] + 1)) {
      return undefined
    }
    return values.length === 1 ? String(values[0]) : `${values[0]}-${values.at(-1)}`
  }

  function createEnvelope({ selectionText, linkUrl, pageUrl, title, diffLocation }) {
    if (!isEligiblePageUrl(pageUrl)) {
      throw new Error("OMP Send Context does not support this page.")
    }
    if (typeof selectionText !== "string" || selectionText.trim().length === 0) {
      throw new Error(isSupportedGithubUrl(pageUrl) ? "Select GitHub code before sending context to OMP." : "Select text before sending context to OMP.")
    }

    const github = isSupportedGithubUrl(pageUrl)
    const url = github && isHttpUrl(linkUrl) ? linkUrl : pageUrl
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
    sections.push(`- Location: ${url}`)
    if (github && diffLocation?.file) {
      sections.push(`- File: ${diffLocation.file}`)
      if (diffLocation.side) {
        sections.push(`- Side: ${diffLocation.side}`)
        if (diffLocation[diffLocation.side]) {
          sections.push(`- Lines: ${diffLocation[diffLocation.side]}`)
        }
      } else if (diffLocation.before || diffLocation.after) {
        const lines = [
          diffLocation.before ? `before ${diffLocation.before}` : "",
          diffLocation.after ? `after ${diffLocation.after}` : "",
        ].filter(Boolean).join("; ")
        sections.push(`- Lines: ${lines}`)
      }
    }

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
    isEligiblePageUrl,
    isSupportedGithubUrl,
    extractGithubDiffLocation,
  }
})
