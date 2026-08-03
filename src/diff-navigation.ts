import { CodeRenderable, LineNumberRenderable, type DiffRenderable, type LineSign, type RGBA } from "@opentui/core"
import { DIFF_VIEW, type DiffView } from "./config"

type SelectedLine = {
  line: number
  colors: Array<{
    renderable: LineNumberRenderable
    gutter: RGBA | undefined
    content: RGBA | undefined
  }>
}

const selectedLines = new WeakMap<DiffRenderable, SelectedLine[]>()
const commentSigns = new WeakMap<DiffRenderable, Array<{
  line: number
  renderable: LineNumberRenderable
  sign: LineSign | undefined
}>>()

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

export function markDiffComments(
  diff: DiffRenderable | undefined,
  ranges: Array<{ start: number; end: number }>,
  color: string,
  reset = false,
) {
  if (!diff) return

  const previous = commentSigns.get(diff)
  if (previous && !reset) {
    for (const saved of previous) {
      if (saved.sign) saved.renderable.setLineSign(saved.line, saved.sign)
      else saved.renderable.clearLineSign(saved.line)
    }
  }

  const lines = new Set<number>()
  for (const range of ranges) {
    for (let line = range.start; line <= range.end; line++) lines.add(line)
  }

  const signs = []
  for (const renderable of getLineNumberRenderables(diff)) {
    const current = renderable.getLineSigns()
    for (const line of lines) {
      const sign = current.get(line)
      signs.push({ line, renderable, sign })
      renderable.setLineSign(line, { ...sign, after: "!", afterColor: color })
    }
  }
  commentSigns.set(diff, signs)
}

export function moveDiffSelection(diff: DiffRenderable | undefined, line: number, amount: number) {
  const lineCount = getCodeRenderables(diff)[0]?.lineCount ?? 0
  return Math.max(0, Math.min(line + amount, Math.max(lineCount - 1, 0)))
}

export function moveDiffSelectionByVisualRows(
  diff: DiffRenderable | undefined,
  line: number,
  amount: number,
) {
  const sources = getCodeRenderables(diff)[0]?.lineInfo.lineSources ?? []
  const visualLine = amount < 0
    ? sources.findLastIndex((source) => source === line)
    : sources.findIndex((source) => source === line)
  if (visualLine < 0) return moveDiffSelection(diff, line, amount)
  const target = Math.max(0, Math.min(visualLine + amount, Math.max(sources.length - 1, 0)))
  return sources[target] ?? line
}

export function highlightDiffRange(
  diff: DiffRenderable | undefined,
  start: number,
  end: number,
  color: string,
  reset = false,
) {
  if (!diff) return

  const previous = selectedLines.get(diff)
  if (previous && !reset) {
    for (const line of previous) {
      for (const saved of line.colors) {
        if (saved.gutter || saved.content) {
          saved.renderable.setLineColor(line.line, {
            gutter: saved.gutter,
            content: saved.content,
          })
        } else {
          saved.renderable.clearLineColor(line.line)
        }
      }
    }
  }

  const selected: SelectedLine[] = []
  const first = Math.min(start, end)
  const last = Math.max(start, end)
  for (let line = first; line <= last; line++) {
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
    selected.push({ line, colors })
  }
  selectedLines.set(diff, selected)

  for (const code of getCodeRenderables(diff)) {
    const visualLine = code.lineInfo.lineSources.findIndex((source) => source === end)
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
  line: number,
  direction: -1 | 1,
) {
  const offsets = getChangeOffsets(patch, view)
  const target = direction === 1
    ? offsets.find((offset) => offset > line)
    : offsets.findLast((offset) => offset < line)

  if (target === undefined) return line
  for (const code of getCodeRenderables(diff)) {
    const visualLine = code.lineInfo.lineSources.findIndex((source) => source === target)
    code.scrollY = visualLine >= 0 ? visualLine : target
  }
  return target
}
