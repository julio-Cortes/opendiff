#!/usr/bin/env bun

import { OpenCode } from "@opencode-ai/client"
import { Service } from "@opencode-ai/client/service"
import { render, useKeyboard, useRenderer } from "@opentui/solid"
import { createSignal, For } from "solid-js"

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

const KEYBINDS = {
  quit: [{ name: "q" }, { name: "escape" }, { name: "c", ctrl: true }],
  nextFile: [{ name: "j" }, { name: "down" }],
  previousFile: [{ name: "k" }, { name: "up" }],
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
const result = await client.vcs.diff({
  location: { directory: process.cwd() },
  mode: "working",
})

function App() {
  const renderer = useRenderer()
  const [selected, setSelected] = createSignal(0)
  const current = () => result.data[selected()]

  useKeyboard((key) => {
    const pressed = (bindings: readonly Keybind[]) =>
      bindings.some((binding) => binding.name === key.name && Boolean(binding.ctrl) === key.ctrl)

    if (pressed(KEYBINDS.quit)) {
      renderer.destroy()
      return
    }
    if (pressed(KEYBINDS.nextFile)) {
      setSelected((index) => Math.min(index + 1, result.data.length - 1))
    }
    if (pressed(KEYBINDS.previousFile)) {
      setSelected((index) => Math.max(index - 1, 0))
    }
  })

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={COLORS.canvas}>
      <box height={1} paddingLeft={1} paddingRight={1} backgroundColor={COLORS.panel}>
        <text fg={COLORS.text}>
          <b>opendiff</b>  {result.location.directory}
        </text>
      </box>

      {result.data.length === 0 ? (
        <box flexGrow={1} alignItems="center" justifyContent="center">
          <text fg={COLORS.textMuted}>No working-copy changes</text>
        </box>
      ) : (
        <box flexDirection="row" flexGrow={1}>
          <box width={32} flexDirection="column" borderStyle="single" borderColor={COLORS.border}>
            <For each={result.data}>
              {(file, index) => (
                <text
                  fg={selected() === index() ? COLORS.textStrong : COLORS.textMuted}
                  bg={selected() === index() ? COLORS.selection : COLORS.canvas}
                >
                  {FILE_STATUS[file.status]} {file.file}
                </text>
              )}
            </For>
          </box>

          <box flexGrow={1} flexDirection="column">
            <box height={1} paddingLeft={1} backgroundColor={COLORS.panel}>
              <text fg={COLORS.text}>
                {current()?.file}  <span style={{ fg: COLORS.added }}>+{current()?.additions}</span>{" "}
                <span style={{ fg: COLORS.removed }}>-{current()?.deletions}</span>
              </text>
            </box>
            <diff
              diff={current()?.patch ?? ""}
              view="unified"
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
          {KEYBINDS.nextFile[0].name}/{KEYBINDS.previousFile[0].name} select  {KEYBINDS.quit[0].name} quit
        </text>
      </box>
    </box>
  )
}

await render(() => <App />, { exitOnCtrlC: false })
