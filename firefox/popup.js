const debugButton = document.querySelector("#debug")
const copyButton = document.querySelector("#copy")
const status = document.querySelector("#status")

async function send(message) {
  return browser.runtime.sendMessage(message)
}

function render(enabled) {
  debugButton.textContent = enabled ? "Disable debug logging" : "Enable debug logging"
  status.textContent = enabled ? "Debug logging is enabled." : "Debug logging is disabled."
}

debugButton.addEventListener("click", async () => {
  const result = await send({ type: "toggle-debug" })
  render(result.enabled)
  status.textContent = result.enabled ? "Debug logging enabled." : "Debug logging disabled."
})

copyButton.addEventListener("click", async () => {
  const result = await send({ type: "copy-debug-log" })
  status.textContent = result.ok ? "Debug log copied." : (result.message ?? "Debug log could not be copied.")
})

send({ type: "get-debug-state" }).then(result => render(result.enabled)).catch(() => {
  status.textContent = "Unable to read debug state."
})
