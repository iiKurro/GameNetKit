// A key press in the page -> the text the program understands ("Ctrl+Alt+F9"), and back to what is shown on screen.
const NAMES: Record<string, string> = {
  Space: "Space", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Insert: "Insert", Delete: "Delete",
  ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Tab: "Tab", Enter: "Enter", Backspace: "Backspace", Pause: "Pause",
  NumpadAdd: "NumpadAdd", NumpadSubtract: "NumpadSubtract", NumpadMultiply: "NumpadMultiply", NumpadDivide: "NumpadDivide", NumpadDecimal: "NumpadDecimal",
  Minus: "Minus", Equal: "Equal", Comma: "Comma", Period: "Period", Slash: "Slash", Semicolon: "Semicolon", Quote: "Quote",
  BracketLeft: "BracketLeft", BracketRight: "BracketRight", Backslash: "Backslash", Backquote: "Backquote",
};

/** the key part of a shortcut from KeyboardEvent.code, or "" when it is only a modifier / not supported */
export function keyName(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  if (/^Numpad[0-9]$/.test(code)) return code;
  return NAMES[code] ?? "";
}

export function comboOf(e: KeyboardEvent): string {
  const key = keyName(e.code);
  if (!key) return "";
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Win");
  parts.push(key);
  return parts.join("+");
}

const SHOWN: Record<string, string> = {
  Up: "↑", Down: "↓", Left: "←", Right: "→", Minus: "-", Equal: "=", Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'",
  BracketLeft: "[", BracketRight: "]", Backslash: "\\", Backquote: "`", NumpadAdd: "Num +", NumpadSubtract: "Num -", NumpadMultiply: "Num *", NumpadDivide: "Num /", NumpadDecimal: "Num .",
};

export function parts(combo: string): string[] {
  return combo.split("+").filter(Boolean).map((p) => SHOWN[p] ?? p.replace(/^Numpad(\d)$/, "Num $1"));
}
