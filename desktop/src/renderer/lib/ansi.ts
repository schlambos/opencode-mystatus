// ANSI escape-sequence stripper for the renderer's "Copy card text" path
// (todo 15). The save path keeps ANSI in the .txt file; the clipboard path
// strips it so pasting into a plain-text editor does not leak ESC sequences.
//
// Matches CSI, OSC, and the common single-char SCS sequences the core emits.

const ANSI_ESCAPE =
  /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()[0-9A-Za-z]|\x1b[=>]|\x1b[0-9]+;/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, "");
}