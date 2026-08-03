import type { FileDiffInfo } from "@opencode-ai/client"
import { pathToFiletype, type DiffRenderable } from "@opentui/core"
import { onCleanup } from "solid-js"
import { COLORS, PANE, type DiffView, type DiffWrap, type Pane } from "../config"
import { createSyntaxStyle } from "../syntax"

type DiffPaneProps = {
  activePane: Pane
  file?: FileDiffInfo
  view: DiffView
  wrap: DiffWrap
  onReady: (diff: DiffRenderable) => void
}

export function DiffPane(props: DiffPaneProps) {
  const syntaxStyle = createSyntaxStyle()
  const filetype = () => pathToFiletype(props.file?.file ?? "")

  onCleanup(() => syntaxStyle.destroy())

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
          <span style={{ fg: COLORS.removed }}>-{props.file?.deletions}</span>  [{filetype() ?? "text"}]
        </text>
      </box>
      <diff
        ref={(element: DiffRenderable) => props.onReady(element)}
        diff={props.file?.patch ?? ""}
        filetype={filetype()}
        syntaxStyle={syntaxStyle}
        view={props.view}
        syncScroll
        showLineNumbers
        wrapMode={props.wrap}
        flexGrow={1}
        addedBg={COLORS.addedBackground}
        removedBg={COLORS.removedBackground}
        contextBg={COLORS.canvas}
      />
    </box>
  )
}
