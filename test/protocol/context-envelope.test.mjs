import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import { isContextEnvelope } from "../../omp/bridge-runtime.js"
import { assertEnvelope } from "../../firefox/native-host/omp-send-context-host.mjs"

const schema = JSON.parse(await readFile(new URL("../../protocol/context-envelope.schema.json", import.meta.url), "utf8"))
const fixture = JSON.parse(await readFile(new URL("../../protocol/context-envelope.example.json", import.meta.url), "utf8"))

test("bridge and native host accept the shared context envelope fixture", () => {
  assert.equal(schema.type, "object")
  assert.deepEqual(schema.required, ["version", "source", "prompt"])
  assert.equal(schema.properties.version.const, 1)
  assert.deepEqual(schema.properties.source.enum, ["vscode", "firefox", "ptyxis"])
  assert.equal(schema.properties.prompt.minLength, 1)
  assert.equal(schema.properties.metadata.type, "object")
  assert.equal(schema.properties.metadata.properties.url.type, "string")
  assert.equal(schema.properties.metadata.properties.title.type, "string")
  assert.equal(isContextEnvelope(fixture), true)
  assert.doesNotThrow(() => assertEnvelope(fixture))
})

test("bridge and native host accept a Ptyxis terminal envelope", () => {
  const envelope = {
    ...fixture,
    source: "ptyxis",
    metadata: { application: "org.gnome.Ptyxis", title: "Terminal" },
  }
  assert.equal(isContextEnvelope(envelope), true)
  assert.doesNotThrow(() => assertEnvelope(envelope))
})

test("bridge and native host reject values outside the shared field contract", () => {
  const invalidEnvelopes = [
    [{ ...fixture, version: 2 }, /version 1 context envelope/],
    [{ ...fixture, prompt: "" }, /version 1 context envelope/],
    [{ ...fixture, metadata: [] }, /object metadata/],
    [{ ...fixture, metadata: { url: 42 } }, /string metadata URL/],
    [{ ...fixture, metadata: { title: 42 } }, /string metadata title/],
  ]

  for (const [envelope, error] of invalidEnvelopes) {
    assert.equal(isContextEnvelope(envelope), false)
    assert.throws(() => assertEnvelope(envelope), error)
  }
})

test("bridge and native host reject a source that is not in the shared contract", () => {
  const envelope = { ...fixture, source: "invalid" }
  assert.equal(isContextEnvelope(envelope), false)
  assert.throws(() => assertEnvelope(envelope), /version 1 context envelope/)
})

test("bridge and native host reject array-shaped envelopes", () => {
  const envelope = []
  envelope.version = 1
  envelope.source = "vscode"
  envelope.prompt = "context"
  assert.equal(isContextEnvelope(envelope), false)
  assert.throws(() => assertEnvelope(envelope), /context envelope/)
})
