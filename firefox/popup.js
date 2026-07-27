const debugButton = document.querySelector("#debug")
const copyButton = document.querySelector("#copy")
const status = document.querySelector("#status")
const buttons = [debugButton, copyButton]

async function send(message) {
  return browser.runtime.sendMessage(message)
}

function setBusy(busy) {
  for (const button of buttons) {
    button.disabled = busy
  }
}

function render(enabled) {
  debugButton.textContent = enabled ? "Disable debug logging" : "Enable debug logging"
  status.textContent = enabled ? "Debug logging is enabled." : "Debug logging is disabled."
}

debugButton.textContent = "Loading debug state..."
setBusy(true)

debugButton.addEventListener("click", async () => {
  setBusy(true)
  try {
    const result = await send({ type: "toggle-debug" })
    render(result.enabled)
    status.textContent = result.enabled ? "Debug logging enabled." : "Debug logging disabled."
  } catch {
    status.textContent = "Unable to change debug state."
  } finally {
    setBusy(false)
  }
})

copyButton.addEventListener("click", async () => {
  setBusy(true)
  status.textContent = "Copying debug log..."
  try {
    const result = await send({ type: "copy-debug-log" })
    status.textContent = result.ok ? "Debug log copied." : (result.message ?? "Debug log could not be copied.")
  } catch {
    status.textContent = "Debug log could not be copied."
  } finally {
    setBusy(false)
  }
})

send({ type: "get-debug-state" }).then(result => render(result.enabled)).catch(() => {
  status.textContent = "Unable to read debug state."
}).finally(() => {
  setBusy(false)
})
