const debugButton = document.querySelector("#debug")
const copyButton = document.querySelector("#copy")
const status = document.querySelector("#status")
const version = document.querySelector("#version")

async function send(message) {
  return browser.runtime.sendMessage(message)
}

function render(enabled) {
  debugButton.querySelector("span:last-child").textContent = enabled ? "Disable debug logging" : "Enable debug logging"
  debugButton.setAttribute("aria-pressed", String(enabled))
  status.textContent = enabled ? "> Debug logging is enabled." : "> Debug logging is disabled."
}

debugButton.addEventListener("click", async () => {
  const result = await send({ type: "toggle-debug" })
  render(result.enabled)
})

copyButton.addEventListener("click", async () => {
  const result = await send({ type: "copy-debug-log" })
  status.textContent = result.ok ? "> Debug log copied." : `> ${result.message ?? "Debug log could not be copied."}`
})

version.textContent = `v${browser.runtime.getManifest().version}`
send({ type: "get-debug-state" }).then(result => render(result.enabled)).catch(() => {
  status.textContent = "> Unable to read debug state."
})
