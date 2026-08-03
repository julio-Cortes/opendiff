#!/usr/bin/env bun

import { OpenCode } from "@opencode-ai/client"
import { Service } from "@opencode-ai/client/service"
import type { DiffRenderable, ScrollBoxRenderable } from "@opentui/core"
import { render, useKeyboard, useRenderer } from "@opentui/solid"
import { basename, resolve } from "node:path"
import { createEffect, createSignal } from "solid-js"
import { DiffPane } from "./components/diff-pane"
import { FileTree } from "./components/file-tree"
import { Footer } from "./components/footer"
import {
  COLORS,
  DIFF_MODE,
  DIFF_VIEW,
  DIFF_WRAP,
  KEYBINDS,
  PANE,
  type DiffMode,
  type DiffView,
  type DiffWrap,
  type Keybind,
  type Pane,
} from "./config"
import {
  getDiffLineNumber,
  highlightDiffLine,
  moveDiffSelection,
  moveToChange,
  scrollDiff,
} from "./diff-navigation"
import { loadSettings, saveSettings } from "./settings"

const endpoint = await Service.ensure()
const client = OpenCode.make({
  baseUrl: endpoint.url,
  headers: Service.headers(endpoint),
})
const loadDiff = (mode: DiffMode) => client.vcs.diff({
  location: { directory: process.cwd() },
  mode,
})
const initialResult = await loadDiff(DIFF_MODE.working)
const initialSettings = await loadSettings()

function App() {
  const renderer = useRenderer()
  let fileList: ScrollBoxRenderable | undefined
  let diff: DiffRenderable | undefined
  let editing = false
  const [result, setResult] = createSignal(initialResult)
  const [selected, setSelected] = createSignal(0)
  const [selectedDiffLine, setSelectedDiffLine] = createSignal(0)
  const [activePane, setActivePane] = createSignal<Pane>(PANE.diff)
  const [mode, setMode] = createSignal<DiffMode>(DIFF_MODE.working)
  const [view, setView] = createSignal<DiffView>(initialSettings.view)
  const [wrap, setWrap] = createSignal<DiffWrap>(initialSettings.wrap)
  const current = () => result().data[selected()]
  let highlightedDiff = ""
  const halfPage = () => {
    const height = activePane() === PANE.files ? fileList?.height : diff?.height
    return Math.max(Math.floor((height ?? 2) / 2), 1)
  }

  const refresh = async (nextMode = mode()) => {
    const selectedFile = current()?.file
    const next = await loadDiff(nextMode)
    const matchingIndex = next.data.findIndex((file) => file.file === selectedFile)
    const nextSelected = matchingIndex >= 0 ? matchingIndex : Math.min(selected(), Math.max(next.data.length - 1, 0))

    setResult(next)
    setSelected(nextSelected)
    if (nextMode !== mode()) setSelectedDiffLine(0)
    setMode(nextMode)
  }

  const edit = async () => {
    const file = current()?.file
    if (!file || editing) return

    editing = true
    renderer.suspend()
    try {
      const editor = process.env.VISUAL || process.env.EDITOR || "vi"
      const path = resolve(result().location.directory, file)
      const line = getDiffLineNumber(diff, current()?.patch ?? "", view(), selectedDiffLine())
      const command = [editor]
      if (["vi", "vim", "nvim"].includes(basename(editor)) && line !== undefined) command.push(`+${line}`)
      command.push(path)
      const child = Bun.spawn(command, {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      })
      await child.exited
    } finally {
      renderer.resume()
      editing = false
      await refresh()
    }
  }

  createEffect(() => {
    const line = selectedDiffLine()
    const key = `${current()?.file}\0${current()?.patch}\0${view()}\0${wrap()}`
    const reset = key !== highlightedDiff
    highlightedDiff = key
    queueMicrotask(() => highlightDiffLine(diff, line, COLORS.selection, reset))
  })

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
        setSelectedDiffLine(0)
      } else {
        setSelectedDiffLine((line) => moveDiffSelection(diff, line, 1))
      }
    }
    if (pressed(KEYBINDS.up)) {
      if (activePane() === PANE.files) {
        setSelected((index) => Math.max(index - 1, 0))
        setSelectedDiffLine(0)
      } else {
        setSelectedDiffLine((line) => moveDiffSelection(diff, line, -1))
      }
    }
    if (pressed(KEYBINDS.pageDown)) {
      if (activePane() === PANE.files) {
        setSelected((index) => Math.min(index + halfPage(), Math.max(result().data.length - 1, 0)))
        setSelectedDiffLine(0)
      } else {
        scrollDiff(diff, halfPage())
        setSelectedDiffLine((line) => moveDiffSelection(diff, line, halfPage()))
      }
    }
    if (pressed(KEYBINDS.pageUp)) {
      if (activePane() === PANE.files) {
        setSelected((index) => Math.max(index - halfPage(), 0))
        setSelectedDiffLine(0)
      } else {
        scrollDiff(diff, -halfPage())
        setSelectedDiffLine((line) => moveDiffSelection(diff, line, -halfPage()))
      }
    }
    if (activePane() === PANE.diff && pressed(KEYBINDS.nextChange)) {
      setSelectedDiffLine((line) => moveToChange(diff, current()?.patch ?? "", view(), line, 1))
    }
    if (activePane() === PANE.diff && pressed(KEYBINDS.previousChange)) {
      setSelectedDiffLine((line) => moveToChange(diff, current()?.patch ?? "", view(), line, -1))
    }
    if (pressed(KEYBINDS.refresh)) {
      void refresh()
    }
    if (pressed(KEYBINDS.toggleMode)) {
      void refresh(mode() === DIFF_MODE.working ? DIFF_MODE.branch : DIFF_MODE.working)
    }
    if (pressed(KEYBINDS.edit)) {
      void edit()
    }
    if (pressed(KEYBINDS.toggleView)) {
      const nextView = view() === DIFF_VIEW.unified ? DIFF_VIEW.split : DIFF_VIEW.unified
      setView(nextView)
      void saveSettings({ view: nextView, wrap: wrap() })
    }
    if (pressed(KEYBINDS.toggleWrap)) {
      const nextWrap = wrap() === DIFF_WRAP.none ? DIFF_WRAP.word : DIFF_WRAP.none
      setWrap(nextWrap)
      void saveSettings({ view: view(), wrap: nextWrap })
    }
  })

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={COLORS.canvas}>
      <box height={1} paddingLeft={1} paddingRight={1} backgroundColor={COLORS.panel}>
        <text fg={COLORS.text}>
          <b>opendiff</b>  {result().location.directory}  [{mode()}, {view()}, {wrap()}]
        </text>
      </box>

      {result().data.length === 0 ? (
        <box flexGrow={1} alignItems="center" justifyContent="center">
          <text fg={COLORS.textMuted}>No {mode()} changes</text>
        </box>
      ) : (
        <box flexDirection="row" flexGrow={1}>
          <FileTree
            active={activePane() === PANE.files}
            files={result().data}
            selected={selected()}
            onReady={(element) => (fileList = element)}
          />
          <DiffPane
            activePane={activePane()}
            file={current()}
            view={view()}
            wrap={wrap()}
            onReady={(element) => {
              diff = element
              highlightDiffLine(diff, selectedDiffLine(), COLORS.selection)
            }}
          />
        </box>
      )}

      <Footer activePane={activePane()} />
    </box>
  )
}

await render(() => <App />, { exitOnCtrlC: false })
