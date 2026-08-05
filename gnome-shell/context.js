const MAX_SELECTION_LENGTH = 128 * 1024
const MAX_METADATA_LENGTH = 256

export function isPtyxisApplication(application) {
  return String(application ?? "").toLowerCase().includes("ptyxis")
}

export function createEnvelope({ selectionText, application, windowTitle }) {
  if (typeof selectionText !== "string" || selectionText.trim().length === 0) {
    throw new Error("Select text before sending context to OMP.")
  }

  const text = selectionText.length > MAX_SELECTION_LENGTH
    ? `${selectionText.slice(0, MAX_SELECTION_LENGTH)}\n[selection truncated]`
    : selectionText
  const app = safeMetadata(application, "unknown application")
  const title = safeMetadata(windowTitle, "untitled window")

  return {
    version: 1,
    source: "ptyxis",
    prompt: formatPrompt({ selectionText: text, application: app, windowTitle: title }),
    metadata: {
      application: app,
      title,
    },
  }
}

export function formatPrompt({ selectionText, application, windowTitle }) {
  const fence = codeFence(selectionText)
  return [
    "# OMP Agent Handoff",
    "## Ptyxis terminal",
    `- Application: ${application}`,
    `- Window: ${windowTitle}`,
    "## Selected text",
    `${fence}\n${selectionText}\n${fence}`,
    "",
  ].join("\n\n")
}

function codeFence(text) {
  const longestRun = (text.match(/`+/g) ?? []).reduce((length, run) => Math.max(length, run.length), 0)
  return "`".repeat(Math.max(3, longestRun + 1))
}

function safeMetadata(value, fallback) {
  const text = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : ""
  return (text || fallback).slice(0, MAX_METADATA_LENGTH)
}
