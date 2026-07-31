import { readdir } from "node:fs/promises"

async function collectTests(directory) {
  const tests = []
  const entries = await readdir(directory, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of entries) {
    const path = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, directory)
    if (entry.isDirectory()) {
      tests.push(...await collectTests(path))
    } else if (entry.name.endsWith(".test.mjs") || entry.name.endsWith(".test.ts")) {
      tests.push(path)
    }
  }
  return tests
}

for (const test of await collectTests(new URL("./", import.meta.url))) {
  await import(test.href)
}
