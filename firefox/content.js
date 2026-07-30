browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "capture-context") {
    reportDebug("capture:start")
    return Promise.resolve(captureContext())
  }
  if (message?.type === "notify") {
    showNotification(message.message)
  }
})

function captureContext() {
  const selection = window.getSelection()
  const anchor = selection?.anchorNode?.parentElement?.closest?.("a[href]")
  reportDebug(selection?.toString().trim().length > 0 ? "capture:selection-present" : "capture:selection-empty")
  return {
    selectionText: selection?.toString() ?? "",
    linkUrl: anchor?.href,
    pageUrl: window.location.href,
    title: document.title,
  }
}

function reportDebug(event) {
  void browser.runtime.sendMessage({ type: "debug-event", event }).catch(() => {})
}

function showNotification(message) {
  const notification = document.createElement("div")
  notification.textContent = message
  notification.style.cssText = "box-sizing:border-box;position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);overflow:auto;overflow-wrap:anywhere;padding:10px 14px;border-radius:6px;background:#24292f;color:#fff;font:13px system-ui,sans-serif;box-shadow:0 2px 8px #0006"
  document.body.append(notification)
  setTimeout(() => notification.remove(), 3500)
}
