import type { FileDiffInfo } from "@opencode-ai/client"

export const COLORS = {
  canvas: "#0d1117",
  panel: "#161b22",
  border: "#30363d",
  text: "#f0f6fc",
  textStrong: "#ffffff",
  textMuted: "#8b949e",
  selection: "#1f6feb",
  added: "#3fb950",
  removed: "#f85149",
  addedBackground: "#12261e",
  removedBackground: "#2d1518",
  syntaxKeyword: "#ff7b72",
  syntaxString: "#a5d6ff",
  syntaxComment: "#8b949e",
  syntaxNumber: "#79c0ff",
  syntaxFunction: "#d2a8ff",
  syntaxType: "#ffa657",
  syntaxProperty: "#79c0ff",
} as const

export const LAYOUT = {
  fileTreeWidth: "30%",
  fileTreeMinWidth: 20,
  fileTreeMaxWidth: 48,
} as const

export type Keybind = {
  name: string
  ctrl?: boolean
}

export const DIFF_VIEW = {
  unified: "unified",
  split: "split",
} as const

export type DiffView = (typeof DIFF_VIEW)[keyof typeof DIFF_VIEW]

export const DIFF_MODE = {
  working: "working",
  branch: "branch",
} as const

export type DiffMode = (typeof DIFF_MODE)[keyof typeof DIFF_MODE]

export const DIFF_WRAP = {
  none: "none",
  word: "word",
} as const

export type DiffWrap = (typeof DIFF_WRAP)[keyof typeof DIFF_WRAP]

export const PANE = {
  files: "files",
  diff: "diff",
} as const

export type Pane = (typeof PANE)[keyof typeof PANE]

export const KEYBINDS = {
  comment: [{ name: "c" }],
  quit: [{ name: "q" }, { name: "escape" }, { name: "c", ctrl: true }],
  down: [{ name: "j" }, { name: "down" }],
  edit: [{ name: "e" }],
  nextChange: [{ name: "]" }],
  pageDown: [{ name: "d", ctrl: true }],
  pageUp: [{ name: "u", ctrl: true }],
  previousChange: [{ name: "[" }],
  up: [{ name: "k" }, { name: "up" }],
  refresh: [{ name: "r" }],
  select: [{ name: "return" }],
  switchPane: [{ name: "tab" }],
  toggleMode: [{ name: "b" }],
  toggleView: [{ name: "s" }],
  toggleWrap: [{ name: "w" }],
  visual: [{ name: "v" }],
} as const satisfies Record<string, readonly Keybind[]>

export const FILE_STATUS = {
  added: "A",
  deleted: "D",
  modified: "M",
} as const satisfies Record<FileDiffInfo["status"], string>

export function formatKeybind(keybind: Keybind) {
  return keybind.ctrl ? `C-${keybind.name}` : keybind.name
}
