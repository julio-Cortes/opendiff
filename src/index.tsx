#!/usr/bin/env bun

import { OpenCode } from "@opencode-ai/client"
import { Service } from "@opencode-ai/client/service"
import { CodeRenderable, type DiffRenderable, type ScrollBoxRenderable } from "@opentui/core"
import { render, useKeyboard, useRenderer } from "@opentui/solid"
import { createEffect, createSignal, For } from "solid-js"

const COLORS = {
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
} as const

type Keybind = {
  name: string
  ctrl?: boolean
}

const DIFF_VIEW = {
  unified: "unified",
  split: "split",
} as const

type DiffView = (typeof DIFF_VIEW)[keyof typeof DIFF_VIEW]

const PANE = {
  files: "files",
  diff: "diff",
} as const

type Pane = (typeof PANE)[keyof typeof PANE]

const KEYBINDS = {
  quit: [{ name: "q" }, { name: "escape" }, { name: "c", ctrl: true }],
  down: [{ name: "j" }, { name: "down" }],
  nextChange: [{ name: "]" }],
  pageDown: [{ name: "d", ctrl: true }],
  pageUp: [{ name: "u", ctrl: true }],
  previousChange: [{ name: "[" }],
  up: [{ name: "k" }, { name: "up" }],
  refresh: [{ name: "r" }],
  switchPane: [{ name: "tab" }],
  toggleView: [{ name: "v" }],
} as const satisfies Record<string, readonly Keybind[]>

const FILE_STATUS = {
  added: "A",
  deleted: "D",
  modified: "M",
} as const

const endpoint = await Service.ensure()
const client = OpenCode.make({
  baseUrl: endpoint.url,
  headers: Service.headers(endpoint),
})
const loadDiff = () => client.vcs.diff({
  location: { directory: process.cwd() },
  mode: "working",
})
const initialResult = await loadDiff()

function getCodeRenderables(diff: DiffRenderable | undefined) {
  const pending = diff ? [...diff.getChildren()] : []
  const codeRenderables: CodeRenderable[] = []

  while (pending.length > 0) {
    const renderable = pending.pop()
    if (!renderable) continue
    if (renderable instanceof CodeRenderable) codeRenderables.push(renderable)
    pending.push(...renderable.getChildren())
  }

  return codeRenderables
}

function scrollDiff(diff: DiffRenderable | undefined, amount: number) {
  for (const code of getCodeRenderables(diff)) code.scrollY += amount
}

function getChangeOffsets(patch: string, view: DiffView) {
  const hunks: string[][] = []

  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      hunks.push([])
      continue
    }
    if (hunks.length > 0 && /^[ +\\-]/.test(line)) hunks.at(-1)?.push(line)
  }

  const offsets: number[] = []
  let row = 0

  for (const lines of hunks) {
    let index = 0
    while (index < lines.length) {
      const marker = lines[index]?.[0]
      if (marker === " ") {
        row++
        index++
        continue
      }
      if (marker === "\\") {
        index++
        continue
      }

      offsets.push(row)
      let additions = 0
      let deletions = 0
      while (index < lines.length && lines[index]?.[0] !== " ") {
        if (lines[index]?.[0] === "+") additions++
        if (lines[index]?.[0] === "-") deletions++
        index++
      }
      row += view === DIFF_VIEW.unified ? additions + deletions : Math.max(additions, deletions)
    }
  }

  return offsets
}

function moveToChange(diff: DiffRenderable | undefined, patch: string, view: DiffView, direction: -1 | 1) {
  if (!diff) return
  const codeRenderables = getCodeRenderables(diff)
  const scrollTop = codeRenderables[0]?.scrollY ?? 0
  const offsets = getChangeOffsets(patch, view)
  const target = direction === 1
    ? offsets.find((offset) => offset > scrollTop)
    : offsets.findLast((offset) => offset < scrollTop)

  if (target === undefined) return
  for (const code of codeRenderables) code.scrollY = target
}

function App() {
  const renderer = useRenderer()
  let fileList: ScrollBoxRenderable | undefined
  let diff: DiffRenderable | undefined
  const [result, setResult] = createSignal(initialResult)
  const [selected, setSelected] = createSignal(0)
  const [activePane, setActivePane] = createSignal<Pane>(PANE.files)
  const [view, setView] = createSignal<DiffView>(DIFF_VIEW.unified)
  const current = () => result().data[selected()]
  const halfPage = () => {
    const height = activePane() === PANE.files ? fileList?.height : diff?.height
    return Math.max(Math.floor((height ?? 2) / 2), 1)
  }

  createEffect(() => {
    if (!current()) return
    fileList?.scrollChildIntoView(`file-${selected()}`)
  })

  const refresh = async () => {
    const selectedFile = current()?.file
    const next = await loadDiff()
    const matchingIndex = next.data.findIndex((file) => file.file === selectedFile)
    const nextSelected = matchingIndex >= 0 ? matchingIndex : Math.min(selected(), Math.max(next.data.length - 1, 0))

    setResult(next)
    setSelected(nextSelected)
  }

  useKeyboard((key) => {
    const pressed = (bindings: readonly Keybind[]) =>
      bindings.some((binding) => binding.name === key.name && Boolean(binding.ctrl) === key.ctrl)

    if (pressed(KEYBINDS.quit)) {
      renderer.destroy()
      return
    }
    if (pressed(KEYBINDS.switchPane)) {
      key.preventDefault()
      key.stopPropagation()
      setActivePane((pane) => pane === PANE.files ? PANE.diff : PANE.files)
      return
    }
    if (pressed(KEYBINDS.down)) {
      if (activePane() === PANE.files) {
        setSelected((index) => Math.min(index + 1, Math.max(result().data.length - 1, 0)))
      } else {
        scrollDiff(diff, 1)
      }
    }
    if (pressed(KEYBINDS.up)) {
      if (activePane() === PANE.files) {
        setSelected((index) => Math.max(index - 1, 0))
      } else {
        scrollDiff(diff, -1)
      }
    }
    if (pressed(KEYBINDS.pageDown)) {
      if (activePane() === PANE.files) {
        setSelected((index) => Math.min(index + halfPage(), Math.max(result().data.length - 1, 0)))
      } else {
        scrollDiff(diff, halfPage())
      }
    }
    if (pressed(KEYBINDS.pageUp)) {
      if (activePane() === PANE.files) {
        setSelected((index) => Math.max(index - halfPage(), 0))
      } else {
        scrollDiff(diff, -halfPage())
      }
    }
    if (activePane() === PANE.diff && pressed(KEYBINDS.nextChange)) {
      moveToChange(diff, current()?.patch ?? "", view(), 1)
    }
    if (activePane() === PANE.diff && pressed(KEYBINDS.previousChange)) {
      moveToChange(diff, current()?.patch ?? "", view(), -1)
    }
    if (pressed(KEYBINDS.refresh)) {
      void refresh()
    }
    if (pressed(KEYBINDS.toggleView)) {
      setView((currentView) => currentView === DIFF_VIEW.unified ? DIFF_VIEW.split : DIFF_VIEW.unified)
    }
  })

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={COLORS.canvas}>
      <box height={1} paddingLeft={1} paddingRight={1} backgroundColor={COLORS.panel}>
        <text fg={COLORS.text}>
          <b>opendiff</b>  {result().location.directory}  [{view()}]
        </text>
      </box>

      {result().data.length === 0 ? (
        <box flexGrow={1} alignItems="center" justifyContent="center">
          <text fg={COLORS.textMuted}>No working-copy changes</text>
        </box>
      ) : (
        <box flexDirection="row" flexGrow={1}>
          <scrollbox
            ref={(element) => (fileList = element)}
            width={32}
            scrollX={false}
            scrollY
            borderStyle="single"
            borderColor={activePane() === PANE.files ? COLORS.selection : COLORS.border}
          >
            <For each={result().data}>
              {(file, index) => (
                <text
                  id={`file-${index()}`}
                  fg={selected() === index() ? COLORS.textStrong : COLORS.textMuted}
                  bg={selected() === index() ? COLORS.selection : COLORS.canvas}
                >
                  {FILE_STATUS[file.status]} {file.file}
                </text>
              )}
            </For>
          </scrollbox>

          <box
            flexGrow={1}
            flexDirection="column"
            borderStyle="single"
            borderColor={activePane() === PANE.diff ? COLORS.selection : COLORS.border}
          >
            <box height={1} paddingLeft={1} backgroundColor={COLORS.panel}>
              <text fg={COLORS.text}>
                {current()?.file}  <span style={{ fg: COLORS.added }}>+{current()?.additions}</span>{" "}
                <span style={{ fg: COLORS.removed }}>-{current()?.deletions}</span>
              </text>
            </box>
            <diff
              ref={(element: DiffRenderable) => (diff = element)}
              diff={current()?.patch ?? ""}
              view={view()}
              syncScroll
              showLineNumbers
              wrapMode="none"
              flexGrow={1}
              addedBg={COLORS.addedBackground}
              removedBg={COLORS.removedBackground}
              contextBg={COLORS.canvas}
            />
          </box>
        </box>
      )}

      <box height={1} paddingLeft={1} backgroundColor={COLORS.panel}>
        <text fg={COLORS.textMuted}>
          {KEYBINDS.switchPane[0].name} pane [{activePane()}]  {KEYBINDS.down[0].name}/{KEYBINDS.up[0].name} navigate  C-d/C-u page  {KEYBINDS.previousChange[0].name}/{KEYBINDS.nextChange[0].name} change  {KEYBINDS.toggleView[0].name} view  {KEYBINDS.refresh[0].name} refresh  {KEYBINDS.quit[0].name} quit
        </text>
      </box>
    </box>
  )
}

await render(() => <App />, { exitOnCtrlC: false })
