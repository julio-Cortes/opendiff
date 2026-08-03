import { COLORS, formatKeybind, KEYBINDS, type Pane } from "../config"

type FooterProps = {
  activePane: Pane
}

export function Footer(props: FooterProps) {
  return (
    <box height={1} paddingLeft={1} backgroundColor={COLORS.panel}>
      <text fg={COLORS.textMuted}>
        {formatKeybind(KEYBINDS.switchPane[0])} pane [{props.activePane}]  {formatKeybind(KEYBINDS.down[0])}/{formatKeybind(KEYBINDS.up[0])} navigate  {formatKeybind(KEYBINDS.pageDown[0])}/{formatKeybind(KEYBINDS.pageUp[0])} page  {formatKeybind(KEYBINDS.previousChange[0])}/{formatKeybind(KEYBINDS.nextChange[0])} change  {formatKeybind(KEYBINDS.toggleView[0])} view  {formatKeybind(KEYBINDS.toggleWrap[0])} wrap  {formatKeybind(KEYBINDS.refresh[0])} refresh  {formatKeybind(KEYBINDS.quit[0])} quit
      </text>
    </box>
  )
}
