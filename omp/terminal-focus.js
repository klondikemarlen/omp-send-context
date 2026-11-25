export function createTerminalFocusObserver(onFocus) {
  let state = "text"
  let prefixDeadline = 0
  let pasteMarkerOffset = 0
  let mouseBytesRemaining = 0
  let stringIntroducer = ""
  let isStringEscape = false
  let tmuxPrefixOffset = -1

  return function observeTerminalFocus(chunk) {
    if (chunk.length === 0) return

    if (prefixDeadline !== 0 && performance.now() >= prefixDeadline) {
      state = "text"
      prefixDeadline = 0
    }

    const isTextChunk = typeof chunk === "string"
    if (state === "text" && !chunk.includes(isTextChunk ? ESCAPE : 0x1b)) return
    for (let index = 0; index < chunk.length; index++) {
      const character = isTextChunk ? chunk[index] : String.fromCharCode(chunk[index])
      observeCharacter(character)
    }

    // Match OMP's framing deadlines lazily. Active payloads stay opaque;
    // a missing terminator must not hide focus after OMP abandons the frame.
    if (state === "escape" || state === "csi") {
      prefixDeadline = performance.now() + KEY_TIMEOUT_MS
    } else if (state === "paste-start") {
      prefixDeadline = performance.now() + SEQUENCE_TIMEOUT_MS
    } else if (state === "paste") {
      prefixDeadline = performance.now() + PASTE_TIMEOUT_MS
    } else if (state === "control-string") {
      prefixDeadline = performance.now() + STRING_ABANDON_MS
    } else {
      prefixDeadline = 0
    }
  }

  function observeCharacter(character) {
    if (state === "paste") {
      observePasteEnd(character)
      return
    }

    if (state === "control-string") {
      observeStringEnd(character)
      return
    }

    if (state === "legacy-mouse") {
      mouseBytesRemaining--
      if (mouseBytesRemaining === 0) {
        state = "text"
      }
      return
    }

    if (character === ESCAPE) {
      state = "escape"
      return
    }

    switch (state) {
      case "escape":
        observeEscapeIntro(character)
        break
      case "csi":
        observeCsiIntro(character)
        break
      case "paste-start":
        if (character !== PASTE_START_TAIL[pasteMarkerOffset]) {
          state = "text"
        } else if (++pasteMarkerOffset === PASTE_START_TAIL.length) {
          pasteMarkerOffset = 0
          state = "paste"
        }
        break
    }
  }

  function observeEscapeIntro(character) {
    state = "text"
    if (character === "[") {
      state = "csi"
    } else if ("]P_^X".includes(character)) {
      state = "control-string"
      stringIntroducer = character
      isStringEscape = false
      tmuxPrefixOffset = -1
      if (character === "P") {
        tmuxPrefixOffset = 0
      }
    }
  }

  function observeCsiIntro(character) {
    state = "text"
    if (character === "I") {
      onFocus(true)
    } else if (character === "O") {
      onFocus(false)
    } else if (character === "M") {
      // X10 mouse reports have three coordinate/button bytes after CSI M.
      state = "legacy-mouse"
      mouseBytesRemaining = 3
    } else if (character === PASTE_START_TAIL[0]) {
      state = "paste-start"
      pasteMarkerOffset = 1
    }
  }

  function observePasteEnd(character) {
    if (character === PASTE_END[pasteMarkerOffset]) {
      pasteMarkerOffset++
      if (pasteMarkerOffset === PASTE_END.length) {
        state = "text"
      }
    } else {
      pasteMarkerOffset = 0
      if (character === ESCAPE) {
        pasteMarkerOffset = 1
      }
    }
  }

  function observeStringEnd(character) {
    if (tmuxPrefixOffset >= 0 && tmuxPrefixOffset < TMUX_PREFIX.length) {
      if (character === TMUX_PREFIX[tmuxPrefixOffset]) {
        tmuxPrefixOffset++
      } else {
        tmuxPrefixOffset = -1
      }
    }

    if (
      (isStringEscape && character === "\\") ||
      (stringIntroducer === "]" && character === "\x07")
    ) {
      state = "text"
      return
    }

    // A tmux passthrough doubles its payload escapes, including those of an embedded ST.
    if (tmuxPrefixOffset === TMUX_PREFIX.length && isStringEscape && character === ESCAPE) {
      isStringEscape = false
      return
    }

    isStringEscape = character === ESCAPE
  }
}

const ESCAPE = "\x1b"
const PASTE_START_TAIL = "200~"
const PASTE_END = "\x1b[201~"
const TMUX_PREFIX = "tmux;"
const KEY_TIMEOUT_MS = 20
const SEQUENCE_TIMEOUT_MS = 100
const PASTE_TIMEOUT_MS = 500
const STRING_ABANDON_MS = 5_000
