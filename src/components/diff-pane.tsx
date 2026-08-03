import type { FileDiffInfo } from "@opencode-ai/client"
import type { DiffRenderable } from "@opentui/core"
import { COLORS, PANE, type DiffView, type Pane } from "../config"

type DiffPaneProps = {
  activePane: Pane
  file?: FileDiffInfo
  view: DiffView
  onReady: (diff: DiffRenderable) => void
}

export function DiffPane(props: DiffPaneProps) {
  return (
    <box
      flexGrow={1}
      flexDirection="column"
      borderStyle="single"
      borderColor={props.activePane === PANE.diff ? COLORS.selection : COLORS.border}
    >
      <box height={1} paddingLeft={1} backgroundColor={COLORS.panel}>
        <text fg={COLORS.text}>
          {props.file?.file}  <span style={{ fg: COLORS.added }}>+{props.file?.additions}</span>{" "}
          <span style={{ fg: COLORS.removed }}>-{props.file?.deletions}</span>
        </text>
      </box>
      <diff
        ref={(element: DiffRenderable) => props.onReady(element)}
        diff={props.file?.patch ?? ""}
        view={props.view}
        syncScroll
        showLineNumbers
        wrapMode="none"
        flexGrow={1}
        addedBg={COLORS.addedBackground}
        removedBg={COLORS.removedBackground}
        contextBg={COLORS.canvas}
      />
    </box>
  )
}
