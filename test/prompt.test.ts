import test from "node:test"
import assert from "node:assert/strict"

import { buildReference, formatContextPrompt } from "../src/prompt"

test("buildReference formats single line references", () => {
  const reference = buildReference({
    relativePath: "src/example.ts",
    startLine: 7,
    endLine: 7,
  })

  assert.equal(reference, "@src/example.ts#L7")
})

test("formatContextPrompt defaults to a file reference for selected code", () => {
  const prompt = formatContextPrompt({
    relativePath: "src/example.ts",
    startLine: 7,
    endLine: 9,
    selectedText: "const value = 1\nreturn value",
    languageId: "typescript",
  })

  assert.equal(prompt, "In @src/example.ts#L7-L9")
})

test("formatContextPrompt includes selected code in inline mode", () => {
  const prompt = formatContextPrompt({
    relativePath: "src/example.ts",
    startLine: 7,
    endLine: 9,
    selectedText: "const value = 1\nreturn value",
    languageId: "typescript",
  }, "inline")

  assert.equal(prompt, "In @src/example.ts#L7-L9\n\n```typescript\nconst value = 1\nreturn value\n```")
})

test("formatContextPrompt lengthens fence when selection contains backticks", () => {
  const prompt = formatContextPrompt({
    relativePath: "README.md",
    startLine: 1,
    endLine: 3,
    selectedText: "```ts\nconst value = 1\n```",
    languageId: "markdown",
  }, "inline")

  assert.equal(prompt, "In @README.md#L1-L3\n\n````markdown\n```ts\nconst value = 1\n```\n````")
})

test("formatContextPrompt emits only a reference when there is no selection", () => {
  const prompt = formatContextPrompt({
    relativePath: "src/example.ts",
    startLine: 3,
    endLine: 3,
    selectedText: "",
    languageId: "typescript",
  })

  assert.equal(prompt, "In @src/example.ts#L3")
})
