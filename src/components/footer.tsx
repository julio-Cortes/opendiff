import { COLORS, formatKeybind, KEYBINDS } from "../config"

export type FooterContext = "diff" | "files" | "plan" | "thread" | "comment-editor" | "comment-list" | "command-palette" | "error-log" | "loading" | "session-picker"

type FooterProps = {
  context: FooterContext
}

const key = (binding: keyof typeof KEYBINDS) => formatKeybind(KEYBINDS[binding][0])

const HELP: Record<FooterContext, string> = {
  diff: `${key("previousPane")}/${key("nextPane")} pane  ${key("down")}/${key("up")} navigate  ${key("visual")} select  ${key("comment")} comment  ${key("editComment")} edit comment  ${key("comments")} markers  ${key("listComments")} list  ${key("sendComments")} send  ${key("toggleFileTree")} files  ${key("togglePlan")} plan  ${key("commandPalette")} commands  ${key("quit")} quit`,
  files: `${key("previousPane")}/${key("nextPane")} pane  ${key("down")}/${key("up")} navigate  ${key("select")} open  ${key("listComments")} comments  ${key("toggleFileTree")} hide  ${key("togglePlan")} plan  ${key("commandPalette")} commands  ${key("quit")} quit`,
  plan: `${key("previousPane")}/${key("nextPane")} pane  ${key("switchSection")} section  ${key("down")}/${key("up")} navigate  ${key("toggleTask")} toggle  ${key("edit")} edit  ${key("togglePlan")} close`,
  thread: `${key("down")}/${key("up")} scroll  ${key("pageDown")}/${key("pageUp")} page  ${key("replyThread")} reply  ${key("deleteComment")} delete  esc hide`,
  "comment-editor": "enter submit  S-enter newline  esc cancel",
  "comment-list": `${key("down")}/${key("up")} navigate  ${key("select")} open  ${key("editComment")} edit draft  ${key("deleteComment")} delete  ${key("sendComments")} send  esc close`,
  "command-palette": "type to search  up/down select  enter run  esc close",
  "error-log": "esc close",
  loading: "Agent is responding to review comments",
  "session-picker": `up/down navigate  ${key("select")} select  ${key("refreshSessions")} refresh  ${key("quitSessionPicker")} quit`,
}

export function Footer(props: FooterProps) {
  return (
    <box height={1} paddingLeft={1} backgroundColor={COLORS.panel}>
      <text fg={COLORS.textMuted}>{HELP[props.context]}</text>
    </box>
  )
}
