import type { FileDiffInfo } from "@opencode-ai/client"
import type { ScrollBoxRenderable } from "@opentui/core"
import { createEffect, For } from "solid-js"
import { COLORS, FILE_STATUS, LAYOUT } from "../config"

type FileTreeProps = {
  active: boolean
  files: FileDiffInfo[]
  selected: number
  onReady: (fileList: ScrollBoxRenderable) => void
}

export function FileTree(props: FileTreeProps) {
  let fileList: ScrollBoxRenderable | undefined

  createEffect(() => {
    if (!props.files[props.selected]) return
    fileList?.scrollChildIntoView(`file-${props.selected}`)
  })

  return (
    <scrollbox
      ref={(element) => {
        fileList = element
        props.onReady(element)
      }}
      width={LAYOUT.fileTreeWidth}
      minWidth={LAYOUT.fileTreeMinWidth}
      maxWidth={LAYOUT.fileTreeMaxWidth}
      scrollX={false}
      scrollY
      borderStyle="single"
      borderColor={props.active ? COLORS.selection : COLORS.border}
    >
      <For each={props.files}>
        {(file, index) => (
          <text
            id={`file-${index()}`}
            fg={props.selected === index() ? COLORS.textStrong : COLORS.textMuted}
            bg={props.selected === index() ? COLORS.selection : COLORS.canvas}
          >
            {FILE_STATUS[file.status]} {file.file}
          </text>
        )}
      </For>
    </scrollbox>
  )
}
