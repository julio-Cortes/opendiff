import { CodeRenderable, type DiffRenderable } from "@opentui/core"
import { DIFF_VIEW, type DiffView } from "./config"

function getCodeRenderables(diff: DiffRenderable | undefined) {
  const pending = diff ? [...diff.getChildren()] : []
  const codeRenderables: CodeRenderable[] = []

  while (pending.length > 0) {
    const renderable = pending.pop()
    if (!renderable) continue
    if (renderable instanceof CodeRenderable) codeRenderables.push(renderable)
    pending.push(...renderable.getChildren())
  }

  return codeRenderables
}

export function scrollDiff(diff: DiffRenderable | undefined, amount: number) {
  for (const code of getCodeRenderables(diff)) code.scrollY += amount
}

function getChangeOffsets(patch: string, view: DiffView) {
  const hunks: string[][] = []

  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      hunks.push([])
      continue
    }
    if (hunks.length > 0 && /^[ +\\-]/.test(line)) hunks.at(-1)?.push(line)
  }

  const offsets: number[] = []
  let row = 0

  for (const lines of hunks) {
    let index = 0
    while (index < lines.length) {
      const marker = lines[index]?.[0]
      if (marker === " ") {
        row++
        index++
        continue
      }
      if (marker === "\\") {
        index++
        continue
      }

      offsets.push(row)
      let additions = 0
      let deletions = 0
      while (index < lines.length && lines[index]?.[0] !== " ") {
        if (lines[index]?.[0] === "+") additions++
        if (lines[index]?.[0] === "-") deletions++
        index++
      }
      row += view === DIFF_VIEW.unified ? additions + deletions : Math.max(additions, deletions)
    }
  }

  return offsets
}

export function moveToChange(
  diff: DiffRenderable | undefined,
  patch: string,
  view: DiffView,
  direction: -1 | 1,
) {
  if (!diff) return
  const codeRenderables = getCodeRenderables(diff)
  const scrollTop = codeRenderables[0]?.scrollY ?? 0
  const lineSources = codeRenderables[0]?.lineInfo.lineSources ?? []
  const offsets = getChangeOffsets(patch, view).map((offset) => {
    const visualRow = lineSources.findIndex((source) => source >= offset)
    return visualRow >= 0 ? visualRow : offset
  })
  const target = direction === 1
    ? offsets.find((offset) => offset > scrollTop)
    : offsets.findLast((offset) => offset < scrollTop)

  if (target === undefined) return
  for (const code of codeRenderables) code.scrollY = target
}
