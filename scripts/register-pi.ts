import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"

type PiPackage = string | { source: string }

type PiSettings = {
  packages?: PiPackage[]
  [key: string]: unknown
}

const root = resolve(import.meta.dir, "..")
const agentDirectory = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent")
const settingsPath = join(agentDirectory, "settings.json")
const settings = JSON.parse(await readFile(settingsPath, "utf8").catch(() => "{}")) as PiSettings
const packages = settings.packages ?? []
const registered = packages.some((entry) => {
  const source = typeof entry === "string" ? entry : entry.source
  return !source.includes(":") && resolve(agentDirectory, source) === root
})

if (!registered) {
  settings.packages = [...packages, relative(agentDirectory, root) || "."]
  await mkdir(dirname(settingsPath), { recursive: true })
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
}
