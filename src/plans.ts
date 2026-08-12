import { basename, join, relative } from "node:path"
import { SessionBackend } from "./backends/types"

export type PlanTask = {
  line: number
  text: string
  complete: boolean
}

export type PlanPr = {
  path: string
  number: number
  title: string
  branch: string
  status: string
  tasks: PlanTask[]
}

export type FeaturePlan = {
  slug: string
  title: string
  currentPr: number
  prs: PlanPr[]
}

const PLAN_DIRECTORY: Record<SessionBackend, string> = {
  [SessionBackend.OpenCode]: ".opencode",
  [SessionBackend.Pi]: ".pi",
}

const value = (content: string, label: string) =>
  content.match(new RegExp(`^${label}:\\s*([^\\n]+)`, "mi"))?.[1]?.replaceAll("`", "").trim() ?? ""

const parsePr = (root: string, path: string, content: string): PlanPr => {
  const heading = content.match(/^#\s+(?:PR\s+(\d+)\s*:\s*)?(.+)$/m)
  const fileNumber = Number.parseInt(basename(path).match(/^\d+/)?.[0] ?? "0", 10)
  const tasks = content.split("\n").flatMap((line, index) => {
    const match = line.match(/^\s*- \[([ xX])\]\s+(.+)$/)
    return match ? [{ line: index, text: match[2], complete: match[1].toLowerCase() === "x" }] : []
  })

  return {
    path: relative(root, path),
    number: Number.parseInt(heading?.[1] ?? "", 10) || fileNumber,
    title: heading?.[2]?.trim() ?? basename(path, ".md"),
    branch: value(content, "Branch"),
    status: value(content, "Status") || "planned",
    tasks,
  }
}

export async function loadFeaturePlan(root: string, backend: SessionBackend): Promise<FeaturePlan | undefined> {
  const plans = join(root, PLAN_DIRECTORY[backend], "plans")
  const active = Bun.file(join(plans, "ACTIVE"))
  if (!(await active.exists())) return

  const slug = (await active.text()).trim()
  if (!slug) return

  const directory = join(plans, slug)
  const planFile = Bun.file(join(directory, "plan.md"))
  if (!(await planFile.exists())) return

  const content = await planFile.text()
  const paths = Array.fromAsync(new Bun.Glob("*.md").scan({ cwd: join(directory, "prs"), absolute: true }))
  const prs = await Promise.all((await paths).sort().map(async (path) => parsePr(root, path, await Bun.file(path).text())))

  return {
    slug,
    title: content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? slug,
    currentPr: Number.parseInt(value(content, "Current PR"), 10) || prs[0]?.number || 0,
    prs,
  }
}

export async function togglePlanTask(root: string, pr: PlanPr, taskIndex: number) {
  const path = join(root, pr.path)
  const file = Bun.file(path)
  const content = await file.text()
  const lines = content.split("\n")
  const tasks = lines.flatMap((line, index) => /^\s*- \[[ xX]\]\s+/.test(line) ? [index] : [])
  const line = tasks[taskIndex]
  if (line === undefined) return

  lines[line] = lines[line].replace(/^(\s*- \[)([ xX])(\])/, (_, start, state, end) =>
    `${start}${state.toLowerCase() === "x" ? " " : "x"}${end}`)
  await Bun.write(path, lines.join("\n"))
}
