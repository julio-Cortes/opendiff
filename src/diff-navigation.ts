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
let changeOffsetsPatch = ""
let changeOffsets: Partial<Record<DiffView, number[]>> = {}
let snippetRowsPatch = ""
let snippetRowsView: DiffView | undefined
let snippetRows: string[][] = []
const diffRenderables = new WeakMap<DiffRenderable, {
  children: ReturnType<DiffRenderable["getChildren"]>
  code: CodeRenderable[]
  lineNumbers: LineNumberRenderable[]
}>()

function getDiffRenderables(diff: DiffRenderable | undefined) {
  if (!diff) return { code: [], lineNumbers: [] }

  const children = diff.getChildren()
  const cached = diffRenderables.get(diff)
  if (cached && cached.children.length === children.length && cached.children.every((child, index) => child === children[index])) {
    return cached
  }

  const pending = [...children]
  const codeRenderables: CodeRenderable[] = []

  while (pending.length > 0) {
    const renderable = pending.pop()
    if (!renderable) continue
    if (renderable instanceof CodeRenderable) codeRenderables.push(renderable)
    pending.push(...renderable.getChildren())
  }

  const lineNumbers: LineNumberRenderable[] = []
  pending.push(...[...children].reverse())
  while (pending.length > 0) {
    const renderable = pending.pop()
    if (!renderable) continue
    if (renderable instanceof LineNumberRenderable) lineNumbers.push(renderable)
    pending.push(...renderable.getChildren().reverse())
  }

  const renderables = { children, code: codeRenderables, lineNumbers }
  diffRenderables.set(diff, renderables)
  return renderables
}

function getCodeRenderables(diff: DiffRenderable | undefined) {
  return getDiffRenderables(diff).code
}

function getLineNumberRenderables(diff: DiffRenderable) {
  return getDiffRenderables(diff).lineNumbers
}

export function markDiffComments(
  diff: DiffRenderable | undefined,
  ranges: Array<{ start: number; end: number }>,
  color: string,
) {
  if (!diff) return

  const previous = commentSigns.get(diff)
  if (previous) {
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
) {
  if (!diff) return

  const previous = selectedLines.get(diff)
  if (previous) {
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
  const lineNumbers = getLineNumberRenderables(diff).map((renderable) => ({
    renderable,
    current: renderable.getLineColors(),
  }))
  for (let line = first; line <= last; line++) {
    const colors = lineNumbers.map(({ renderable, current }) => {
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

export function remapDiffLine(patch: string, from: DiffView, to: DiffView, line: number) {
  if (from === to) return line

  const lines: Array<string | undefined> = []
  let inHunk = false
  for (const patchLine of patch.split("\n")) {
    if (patchLine.startsWith("@@")) {
      if (inHunk) lines.push(undefined)
      inHunk = true
      continue
    }
    if (inHunk && /^[ +\-\\]/.test(patchLine)) lines.push(patchLine)
  }

  let index = 0
  let fromRow = 0
  let toRow = 0
  while (index < lines.length) {
    const marker = lines[index]?.[0]
    if (marker === undefined) {
      index++
      continue
    }
    if (marker === "\\") {
      index++
      continue
    }
    if (marker === " ") {
      if (line === fromRow) return toRow
      fromRow++
      toRow++
      index++
      continue
    }

    let additions = 0
    let deletions = 0
    while (index < lines.length && lines[index]?.[0] !== " " && lines[index]?.[0] !== undefined) {
      if (lines[index]?.[0] === "+") additions++
      if (lines[index]?.[0] === "-") deletions++
      index++
    }

    const fromSize = from === DIFF_VIEW.unified ? additions + deletions : Math.max(additions, deletions)
    const toSize = to === DIFF_VIEW.unified ? additions + deletions : Math.max(additions, deletions)
    if (line < fromRow + fromSize) {
      const offset = line - fromRow
      if (from === DIFF_VIEW.unified) {
        const item = offset < deletions ? offset : offset - deletions
        return toRow + Math.min(item, Math.max(toSize - 1, 0))
      }
      if (offset < additions) return toRow + deletions + offset
      return toRow + Math.min(offset, Math.max(deletions - 1, 0))
    }
    fromRow += fromSize
    toRow += toSize
  }

  return line
}

export function getDiffSnippet(patch: string, view: DiffView, start: number, end: number) {
  if (patch === snippetRowsPatch && view === snippetRowsView) {
    return snippetRows.slice(start, end + 1).flat().join("\n")
  }

  const hunks: string[][] = []
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      hunks.push([])
      continue
    }
    if (hunks.length > 0 && /^[ +\-\\]/.test(line)) hunks.at(-1)?.push(line)
  }

  const rows: string[][] = []
  if (view === DIFF_VIEW.unified) {
    for (const line of hunks.flat()) {
      if (!line.startsWith("\\")) rows.push([line])
    }
  } else {
    for (const hunk of hunks) {
      let index = 0
      while (index < hunk.length) {
        const line = hunk[index]!
        if (line.startsWith(" ")) {
          rows.push([line])
          index++
          continue
        }
        if (line.startsWith("\\")) {
          index++
          continue
        }

        const removed: string[] = []
        const added: string[] = []
        while (index < hunk.length && !hunk[index]!.startsWith(" ")) {
          const changed = hunk[index]!
          if (changed.startsWith("-")) removed.push(changed)
          if (changed.startsWith("+")) added.push(changed)
          index++
        }
        for (let row = 0; row < Math.max(removed.length, added.length); row++) {
          rows.push([removed[row], added[row]].filter((value): value is string => value !== undefined))
        }
      }
    }
  }

  snippetRowsPatch = patch
  snippetRowsView = view
  snippetRows = rows
  return rows.slice(start, end + 1).flat().join("\n")
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
  if (patch !== changeOffsetsPatch) {
    changeOffsetsPatch = patch
    changeOffsets = {}
  }
  const cached = changeOffsets[view]
  if (cached) return cached

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

  changeOffsets[view] = offsets
  return offsets
}

export function getBoundaryChange(patch: string, view: DiffView, direction: -1 | 1) {
  const offsets = getChangeOffsets(patch, view)
  return direction === 1 ? offsets[0] : offsets.at(-1)
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
