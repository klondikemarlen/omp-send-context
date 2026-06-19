export interface EditorContext {
  readonly relativePath: string
  readonly startLine: number
  readonly endLine: number
  readonly selectedText: string
  readonly languageId: string
}

const DEFAULT_CODE_FENCE = "```"

export function buildReference(context: Pick<EditorContext, "relativePath" | "startLine" | "endLine">) {
  const lineReference = context.startLine === context.endLine
    ? `L${context.startLine}`
    : `L${context.startLine}-L${context.endLine}`

  return `@${context.relativePath}#${lineReference}`
}

export function formatContextPrompt(context: EditorContext) {
  const reference = buildReference(context)

  if (context.selectedText.length === 0) {
    return `In ${reference}`
  }

  const fence = getCodeFence(context.selectedText)
  const language = normalizeLanguageId(context.languageId)

  return `In ${reference}\n\n${fence}${language}\n${context.selectedText}\n${fence}`
}

function normalizeLanguageId(languageId: string) {
  if (languageId.length === 0 || languageId === "plaintext") {
    return ""
  }

  return languageId.replace(/[^a-zA-Z0-9_+-]/g, "")
}

function getCodeFence(text: string) {
  if (!text.includes(DEFAULT_CODE_FENCE)) {
    return DEFAULT_CODE_FENCE
  }

  let fence = "````"
  while (text.includes(fence)) {
    fence += "`"
  }

  return fence
}
