// OMP normally supplies complete terminal events. Keep a partial focus prefix
// because extension input can also arrive at ESC or CSI boundaries.
export function createTerminalActivityTracker() {
  let pendingFocusInput = ""

  return function readTerminalActivity(data) {
    const input = `${pendingFocusInput}${data}`
    pendingFocusInput = input.match(/\x1b(?:\[)?$/)?.[0] ?? ""

    let focusIn = false
    const forwarded = input
      .slice(0, input.length - pendingFocusInput.length)
      .replace(/\x1b\[([IO])/g, (_report, state) => {
        if (state === "I") {
          focusIn = true
        }
        return ""
      })

    return {
      data: forwarded,
      hasActivity: focusIn || hasKeyboardInput(forwarded),
    }
  }
}

function hasKeyboardInput(input) {
  // Replies and mouse reports may arrive without keyboard focus, especially
  // after a restart. Leave them intact for OMP, but never select a console.
  const keyboardInput = input
    .replace(/\x1b\[[0-9;:?=>$]*[Rcnty]/g, "")
    .replace(/\x1b\[\?[0-9;]*[uS]/g, "")
    .replace(/\x1b\[<[0-9;]+[Mm]/g, "")
    .replace(/\x1b\[M[\s\S]{3}/g, "")
    .replace(/\x1b(?:\]|P|_|^)[\s\S]*?(?:\x07|\x1b\\)/g, "")
  return keyboardInput.length > 0
}
