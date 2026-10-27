const MAX_SELECTION_LENGTH = 128 * 1024
const MAX_METADATA_LENGTH = 256

export function isApplicationBlocked(application, blocklist) {
  if (typeof application !== "string" || !application.endsWith(".desktop")) {
    return true
  }

  return Array.isArray(blocklist) && blocklist.includes(application)
}

export function createEnvelope({ selectionText, application, windowTitle }) {
  if (typeof selectionText !== "string" || selectionText.trim().length === 0) {
    throw new Error("Select text before sending context to OMP.")
  }

  const boundedSelectionText =
    selectionText.length > MAX_SELECTION_LENGTH
      ? `${selectionText.slice(0, MAX_SELECTION_LENGTH)}\n[selection truncated]`
      : selectionText
  const applicationName = sanitizeMetadata(application, "unknown application")
  const sanitizedWindowTitle = sanitizeMetadata(windowTitle, "untitled window")

  return {
    version: 1,
    source: "gnome",
    prompt: formatPrompt({
      selectionText: boundedSelectionText,
      application: applicationName,
      windowTitle: sanitizedWindowTitle,
    }),
    metadata: {
      application: applicationName,
      title: sanitizedWindowTitle,
    },
  }
}

export function formatPrompt({ selectionText, application: applicationName, windowTitle }) {
  const selectionFence = createSelectionFence(selectionText)
  return [
    "# OMP Agent Handoff",
    "## GNOME desktop application",
    `- Application: ${applicationName}`,
    `- Window: ${windowTitle}`,
    "## Selected text",
    `${selectionFence}\n${selectionText}\n${selectionFence}`,
    "",
  ].join("\n\n")
}

function createSelectionFence(selectionText) {
  const longestBacktickRun = (selectionText.match(/`+/g) ?? []).reduce(
    (longestRun, backtickRun) => Math.max(longestRun, backtickRun.length),
    0
  )
  return "`".repeat(Math.max(3, longestBacktickRun + 1))
}

function sanitizeMetadata(value, fallback) {
  if (typeof value !== "string") {
    return fallback
  }

  const cleanedText = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim()
  if (!cleanedText) {
    return fallback
  }

  return cleanedText.slice(0, MAX_METADATA_LENGTH)
}
