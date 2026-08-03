#!/usr/bin/env bun

import { OpenCode } from "@opencode-ai/client"
import { Service } from "@opencode-ai/client/service"
import type { DiffRenderable, ScrollBoxRenderable } from "@opentui/core"
import { render, useKeyboard, useRenderer } from "@opentui/solid"
import { createSignal } from "solid-js"
import { DiffPane } from "./components/diff-pane"
import { FileTree } from "./components/file-tree"
import { Footer } from "./components/footer"
import {
  COLORS,
  DIFF_VIEW,
  DIFF_WRAP,
  KEYBINDS,
  PANE,
  type DiffView,
  type DiffWrap,
  type Keybind,
  type Pane,
} from "./config"
import { moveToChange, scrollDiff } from "./diff-navigation"

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

function App() {
  const renderer = useRenderer()
  let fileList: ScrollBoxRenderable | undefined
  let diff: DiffRenderable | undefined
  const [result, setResult] = createSignal(initialResult)
  const [selected, setSelected] = createSignal(0)
  const [activePane, setActivePane] = createSignal<Pane>(PANE.files)
  const [view, setView] = createSignal<DiffView>(DIFF_VIEW.unified)
  const [wrap, setWrap] = createSignal<DiffWrap>(DIFF_WRAP.none)
  const current = () => result().data[selected()]
  const halfPage = () => {
    const height = activePane() === PANE.files ? fileList?.height : diff?.height
    return Math.max(Math.floor((height ?? 2) / 2), 1)
  }

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
    if (pressed(KEYBINDS.toggleWrap)) {
      setWrap((currentWrap) => currentWrap === DIFF_WRAP.none ? DIFF_WRAP.word : DIFF_WRAP.none)
    }
  })

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={COLORS.canvas}>
      <box height={1} paddingLeft={1} paddingRight={1} backgroundColor={COLORS.panel}>
        <text fg={COLORS.text}>
          <b>opendiff</b>  {result().location.directory}  [{view()}, {wrap()}]
        </text>
      </box>

      {result().data.length === 0 ? (
        <box flexGrow={1} alignItems="center" justifyContent="center">
          <text fg={COLORS.textMuted}>No working-copy changes</text>
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
            onReady={(element) => (diff = element)}
          />
        </box>
      )}

      <Footer activePane={activePane()} />
    </box>
  )
}

await render(() => <App />, { exitOnCtrlC: false })
