import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { DIFF_VIEW, DIFF_WRAP, type DiffView, type DiffWrap } from "./config"

export type Settings = {
  view: DiffView
  wrap: DiffWrap
}

const DEFAULT_SETTINGS: Settings = {
  view: DIFF_VIEW.unified,
  wrap: DIFF_WRAP.none,
}

const settingsPath = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "opendiff", "config.json")

export async function loadSettings() {
  const file = Bun.file(settingsPath)
  if (!(await file.exists())) return DEFAULT_SETTINGS
  return file.json() as Promise<Settings>
}

export async function saveSettings(settings: Settings) {
  await mkdir(dirname(settingsPath), { recursive: true })
  await Bun.write(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
}
