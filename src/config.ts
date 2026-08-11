import type { FileDiffInfo } from "@opencode-ai/client"
import { RGBA, rgbToHex, type TerminalColors, type ThemeMode } from "@opentui/core"

export const COLORS = {
  canvas: "#0d1117",
  panel: "#161b22",
  border: "#30363d",
  text: "#f0f6fc",
  textStrong: "#ffffff",
  textMuted: "#8b949e",
  selection: "#1f6feb",
  comment: "#d29922",
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
}

export function applySystemColors(colors: TerminalColors, mode: ThemeMode) {
  const background = colors.defaultBackground ?? colors.palette[0]
  const foreground = colors.defaultForeground ?? colors.palette[7]
  if (!background || !foreground) return

  const bg = RGBA.fromHex(background)
  const isDark = mode === "dark"
  const ansi = (index: number, fallback: string) => colors.palette[index] ?? fallback
  const mix = (color: string, amount: number) => {
    const target = RGBA.fromHex(color)
    return rgbToHex(RGBA.fromValues(
      bg.r + (target.r - bg.r) * amount,
      bg.g + (target.g - bg.g) * amount,
      bg.b + (target.b - bg.b) * amount,
    ))
  }
  const gray = (step: number) => {
    const amount = step / 12 * 0.4
    const target = isDark ? 1 : 0
    return rgbToHex(RGBA.fromValues(
      bg.r + (target - bg.r) * amount,
      bg.g + (target - bg.g) * amount,
      bg.b + (target - bg.b) * amount,
    ))
  }

  const red = ansi(1, "#800000")
  const green = ansi(2, "#008000")
  const yellow = ansi(3, "#808000")
  const blue = ansi(4, "#000080")
  const magenta = ansi(5, "#800080")
  const cyan = ansi(6, "#008080")
  const diffAlpha = isDark ? 0.22 : 0.14

  Object.assign(COLORS, {
    canvas: background,
    panel: gray(2),
    border: gray(7),
    text: foreground,
    textStrong: foreground,
    textMuted: gray(10),
    selection: mix(cyan, isDark ? 0.35 : 0.2),
    comment: yellow,
    added: green,
    removed: red,
    addedBackground: mix(green, diffAlpha),
    removedBackground: mix(red, diffAlpha),
    syntaxKeyword: magenta,
    syntaxString: green,
    syntaxComment: gray(10),
    syntaxNumber: yellow,
    syntaxFunction: blue,
    syntaxType: cyan,
    syntaxProperty: cyan,
  })
}

export const LAYOUT = {
  fileTreeWidth: "30%",
  fileTreeMinWidth: 20,
  fileTreeMaxWidth: 48,
  planSidebarWidth: "32%",
  planSidebarMinWidth: 32,
  planSidebarMaxWidth: 56,
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
  plan: "plan",
} as const

export type Pane = (typeof PANE)[keyof typeof PANE]

export const KEYBINDS = {
  comment: [{ name: "c" }],
  commandPalette: [{ name: "p", ctrl: true }],
  comments: [{ name: "m" }],
  deleteComment: [{ name: "d" }],
  quit: [{ name: "q" }, { name: "escape" }, { name: "c", ctrl: true }],
  down: [{ name: "j" }, { name: "down" }],
  edit: [{ name: "e" }],
  editComment: [{ name: "i" }],
  listComments: [{ name: "l", ctrl: true }],
  nextPane: [{ name: "l" }],
  nextChange: [{ name: "]" }],
  pageDown: [{ name: "d", ctrl: true }],
  pageUp: [{ name: "u", ctrl: true }],
  previousChange: [{ name: "[" }],
  previousPane: [{ name: "h" }],
  up: [{ name: "k" }, { name: "up" }],
  refresh: [{ name: "r" }],
  replyThread: [{ name: "f" }],
  sendComments: [{ name: "a" }],
  select: [{ name: "return" }],
  switchSection: [{ name: "tab" }],
  toggleMode: [{ name: "b" }],
  toggleFileTree: [{ name: "t" }],
  toggleView: [{ name: "s" }],
  toggleWrap: [{ name: "w" }],
  togglePlan: [{ name: "p" }],
  toggleTask: [{ name: "space" }],
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
