import { COLORS, formatKeybind, KEYBINDS } from "../config"

export type FooterContext = "diff" | "files" | "comment-editor" | "comment-list" | "loading"

type FooterProps = {
  context: FooterContext
}

const key = (binding: keyof typeof KEYBINDS) => formatKeybind(KEYBINDS[binding][0])

const HELP: Record<FooterContext, string> = {
  diff: `${key("down")}/${key("up")} navigate  ${key("visual")} select  ${key("comment")} comment  ${key("editComment")} edit comment  ${key("deleteComment")} delete  ${key("comments")} markers  ${key("listComments")} list  ${key("sendComments")} send  ${key("edit")} edit file  ${key("toggleView")} view  ${key("toggleWrap")} wrap  ${key("quit")} quit`,
  files: `${key("down")}/${key("up")} navigate  ${key("select")} open  ${key("switchPane")} diff  ${key("listComments")} comments  ${key("sendComments")} send  ${key("refresh")} refresh  ${key("quit")} quit`,
  "comment-editor": "enter submit  S-enter newline  esc cancel",
  "comment-list": `${key("down")}/${key("up")} navigate  ${key("select")} open  ${key("editComment")} edit draft  ${key("deleteComment")} delete  esc close`,
  loading: "Agent is responding to review comments",
}

export function Footer(props: FooterProps) {
  return (
    <box height={1} paddingLeft={1} backgroundColor={COLORS.panel}>
      <text fg={COLORS.textMuted}>{HELP[props.context]}</text>
    </box>
  )
}
