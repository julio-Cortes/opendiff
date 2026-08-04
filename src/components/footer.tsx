import { COLORS, formatKeybind, KEYBINDS } from "../config"

export type FooterContext = "diff" | "files" | "comment-editor" | "comment-list" | "command-palette" | "loading"

type FooterProps = {
  context: FooterContext
}

const key = (binding: keyof typeof KEYBINDS) => formatKeybind(KEYBINDS[binding][0])

const HELP: Record<FooterContext, string> = {
  diff: `${key("down")}/${key("up")} navigate  ${key("visual")} select  ${key("comment")} comment  ${key("editComment")} edit comment  ${key("comments")} markers  ${key("listComments")} list  ${key("sendComments")} send  ${key("commandPalette")} commands  ${key("quit")} quit`,
  files: `${key("down")}/${key("up")} navigate  ${key("select")} open  ${key("switchPane")} diff  ${key("listComments")} comments  ${key("commandPalette")} commands  ${key("quit")} quit`,
  "comment-editor": "enter submit  S-enter newline  esc cancel",
  "comment-list": `${key("down")}/${key("up")} navigate  ${key("select")} open  ${key("editComment")} edit draft  ${key("deleteComment")} delete  esc close`,
  "command-palette": "type to search  up/down select  enter run  esc close",
  loading: "Agent is responding to review comments",
}

export function Footer(props: FooterProps) {
  return (
    <box height={1} paddingLeft={1} backgroundColor={COLORS.panel}>
      <text fg={COLORS.textMuted}>{HELP[props.context]}</text>
    </box>
  )
}
