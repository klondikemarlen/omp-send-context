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
