import { CodeRenderable, LineNumberRenderable, type DiffRenderable, type RGBA } from "@opentui/core"
import { DIFF_VIEW, type DiffView } from "./config"

type SelectedLine = {
  line: number
  colors: Array<{
    renderable: LineNumberRenderable
    gutter: RGBA | undefined
    content: RGBA | undefined
  }>
}

const selectedLines = new WeakMap<DiffRenderable, SelectedLine>()

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

function getLineNumberRenderables(diff: DiffRenderable) {
  const pending = [...diff.getChildren()].reverse()
  const lineNumbers: LineNumberRenderable[] = []

  while (pending.length > 0) {
    const renderable = pending.pop()
    if (!renderable) continue
    if (renderable instanceof LineNumberRenderable) lineNumbers.push(renderable)
    pending.push(...renderable.getChildren().reverse())
  }

  return lineNumbers
}

export function moveDiffSelection(diff: DiffRenderable | undefined, line: number, amount: number) {
  const lineCount = getCodeRenderables(diff)[0]?.lineCount ?? 0
  return Math.max(0, Math.min(line + amount, Math.max(lineCount - 1, 0)))
}

export function highlightDiffLine(
  diff: DiffRenderable | undefined,
  line: number,
  color: string,
  reset = false,
) {
  if (!diff) return

  const previous = selectedLines.get(diff)
  if (previous && !reset) {
    for (const saved of previous.colors) {
      if (saved.gutter || saved.content) {
        saved.renderable.setLineColor(previous.line, {
          gutter: saved.gutter,
          content: saved.content,
        })
      } else {
        saved.renderable.clearLineColor(previous.line)
      }
    }
  }

  const colors = getLineNumberRenderables(diff).map((renderable) => {
    const current = renderable.getLineColors()
    const saved = {
      renderable,
      gutter: current.gutter.get(line),
      content: current.content.get(line),
    }
    renderable.setLineColor(line, { gutter: color, content: color })
    return saved
  })
  selectedLines.set(diff, { line, colors })

  for (const code of getCodeRenderables(diff)) {
    const visualLine = code.lineInfo.lineSources.findIndex((source) => source === line)
    if (visualLine < 0 || code.height === 0) continue
    if (visualLine < code.scrollY) code.scrollY = visualLine
    if (visualLine >= code.scrollY + code.height) code.scrollY = visualLine - code.height + 1
  }
}

export function getDiffLineNumber(
  diff: DiffRenderable | undefined,
  patch: string,
  view: DiffView,
  selectedLine: number,
) {
  if (diff && view === DIFF_VIEW.split) {
    const rightSide = getLineNumberRenderables(diff).at(-1)
    const lineNumbers = [...(rightSide?.getLineNumbers() ?? new Map<number, number>())]
    const exact = lineNumbers.find(([line]) => line === selectedLine)
    if (exact) return exact[1]
    const next = lineNumbers.find(([line]) => line > selectedLine)
    if (next) return next[1]
    const previous = lineNumbers.findLast(([line]) => line < selectedLine)
    return previous ? previous[1] + 1 : 1
  }

  const hunks: Array<{ newStart: number; lines: string[] }> = []

  for (const line of patch.split("\n")) {
    const header = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (header) {
      hunks.push({ newStart: Number(header[1]), lines: [] })
      continue
    }
    if (hunks.length > 0 && /^[ +\-\\]/.test(line)) hunks.at(-1)?.lines.push(line)
  }

  let row = 0

  for (const hunk of hunks) {
    let newLine = hunk.newStart

    for (const line of hunk.lines) {
      const marker = line[0]
      if (marker === "\\") continue
      if (row === selectedLine) return Math.max(newLine, 1)
      if (marker !== "-") newLine++
      row++
    }
  }
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
