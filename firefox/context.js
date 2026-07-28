(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory()
  } else {
    root.ompSendContext = factory()
  }
})(typeof globalThis === "object" ? globalThis : this, function () {
  function isSupportedGithubUrl(value) {
    try {
      const url = new URL(value)
      return url.protocol === "https:" && url.hostname === "github.com" && /^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/.test(url.pathname)
    } catch {
      return false
    }
  }

  function isEligiblePageUrl(value) {
    return isHttpUrl(value)
  }

  function createEnvelope({ selectionText, linkUrl, pageUrl, title }) {
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
      prompt: formatPrompt({ selectionText, url, title, github }),
      metadata: {
        url,
        ...(typeof title === "string" && title.length > 0 ? { title } : {}),
      },
    }
  }

  function formatPrompt({ selectionText, url, title, github = true }) {
    const sections = ["# OMP Agent Handoff", github ? "## GitHub" : "## Web page"]
    if (typeof title === "string" && title.length > 0) {
      sections.push(`- Title: ${title}`)
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
  }
})
