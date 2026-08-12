import type { ScrollBoxRenderable } from "@opentui/core"
import { createEffect, For } from "solid-js"
import type { BackendSession } from "../backends/types"
import { COLORS } from "../config"
import { Footer } from "./footer"

type SessionPickerProps = {
  directory: string
  sessions: BackendSession[]
  selected: number
  query: string
  onQuery: (query: string) => void
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
          <box height={3} paddingLeft={1} paddingRight={1} flexDirection="column">
            <text fg={COLORS.text}>Sessions in {props.directory}</text>
            <text fg={COLORS.textMuted}>{props.sessions.length} available</text>
            <input
              focused
              placeholder="Search sessions"
              value={props.query}
              textColor={COLORS.text}
              backgroundColor={COLORS.canvas}
              focusedTextColor={COLORS.text}
              focusedBackgroundColor={COLORS.canvas}
              onInput={props.onQuery}
            />
          </box>
          {props.sessions.length === 0 ? (
            <box flexGrow={1} alignItems="center" justifyContent="center">
              <text fg={COLORS.textMuted}>No matching sessions</text>
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
                    [{session.backend}, {session.availability}] {session.title ?? "Untitled session"}  {session.id}
                  </text>
                )}
              </For>
            </scrollbox>
          )}
        </box>
      </box>
      <Footer context="session-picker" />
    </box>
  )
}
