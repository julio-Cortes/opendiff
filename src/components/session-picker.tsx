import type { ScrollBoxRenderable } from "@opentui/core"
import { createEffect, For } from "solid-js"
import { COLORS } from "../config"

type SessionPickerProps = {
  directory: string
  sessions: Array<{
    id: string
    title?: string
    backend: "opencode" | "pi"
  }>
  selected: number
}

export function SessionPicker(props: SessionPickerProps) {
  let sessionList: ScrollBoxRenderable | undefined

  createEffect(() => {
    if (!props.sessions[props.selected]) return
    sessionList?.scrollChildIntoView(`session-${props.selected}`)
  })

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={COLORS.canvas}>
      <box height={1} paddingLeft={1} backgroundColor={COLORS.panel}>
        <text fg={COLORS.text}><b>opendiff</b>  Select agent session</text>
      </box>
      <box flexGrow={1} alignItems="center" justifyContent="center">
        <box width="80%" maxWidth={100} height="70%" flexDirection="column" borderStyle="single" borderColor={COLORS.selection}>
          <box height={2} paddingLeft={1} flexDirection="column">
            <text fg={COLORS.text}>Sessions in {props.directory}</text>
            <text fg={COLORS.textMuted}>{props.sessions.length} available</text>
          </box>
          {props.sessions.length === 0 ? (
            <box flexGrow={1} alignItems="center" justifyContent="center">
              <text fg={COLORS.textMuted}>No agent sessions in this directory</text>
            </box>
          ) : (
            <scrollbox ref={(element) => (sessionList = element)} flexGrow={1} scrollX={false} scrollY>
              <For each={props.sessions}>
                {(session, index) => (
                  <text
                    id={`session-${index()}`}
                    fg={props.selected === index() ? COLORS.textStrong : COLORS.textMuted}
                    bg={props.selected === index() ? COLORS.selection : COLORS.canvas}
                  >
                    [{session.backend}] {session.title ?? "Untitled session"}  {session.id}
                  </text>
                )}
              </For>
            </scrollbox>
          )}
        </box>
      </box>
      <box height={1} paddingLeft={1} backgroundColor={COLORS.panel}>
        <text fg={COLORS.textMuted}>j/k navigate  enter select  q quit</text>
      </box>
    </box>
  )
}
