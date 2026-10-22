// OMP resolves raw byte boundaries before calling onTerminalInput.
// Observe complete events without buffering keys or interpreting pasted content.
export function classifyTerminalActivity(input) {
  if (input === "\x1b[I") {
    return { data: "", hasActivity: true }
  }
  if (input === "\x1b[O") {
    return { data: "", hasActivity: false }
  }

  return { data: input, hasActivity: hasKeyboardInput(input) }
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
