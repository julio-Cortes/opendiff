#!/usr/bin/env bun

import { OpenCode } from "@opencode-ai/client"
import { Service } from "@opencode-ai/client/service"
import { createCliRenderer, type DiffRenderable, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { render, useKeyboard, useRenderer } from "@opentui/solid"
import { basename, resolve } from "node:path"
import { createEffect, createSignal, For, Show } from "solid-js"
import { createOpenCodeBackend } from "./backends/opencode"
import { piBackend } from "./backends/pi"
import type { SessionBackendAdapter } from "./backends/types"
import { DiffPane } from "./components/diff-pane"
import { FileTree } from "./components/file-tree"
import { Footer } from "./components/footer"
import { PlanSidebar } from "./components/plan-sidebar"
import { SessionPicker } from "./components/session-picker"
import {
  COLORS,
  applySystemColors,
  DIFF_MODE,
  DIFF_VIEW,
  DIFF_WRAP,
  formatKeybind,
  KEYBINDS,
  PANE,
  type DiffMode,
  type DiffView,
  type DiffWrap,
  type Keybind,
  type Pane,
} from "./config"
import {
  getBoundaryChange,
  getDiffSnippet,
  getDiffLineNumber,
  highlightDiffRange,
  markDiffComments,
  moveDiffSelection,
  moveDiffSelectionByVisualRows,
  moveToChange,
  remapDiffLine,
} from "./diff-navigation"
import { loadReviewComments, saveReviewComments, type ReviewComment } from "./review-comments"
import { loadSettings, saveSettings } from "./settings"
import { loadFeaturePlan, togglePlanTask, type FeaturePlan } from "./plans"

const endpoint = await Service.ensure()
const client = OpenCode.make({
  baseUrl: endpoint.url,
  headers: Service.headers(endpoint),
})
const sessionBackends: SessionBackendAdapter[] = [createOpenCodeBackend(client), piBackend]
const sessionBackendByName = new Map(sessionBackends.map((backend) => [backend.backend, backend]))
const loadSessions = async () => (await Promise.all(
  sessionBackends.map((backend) => backend.list(process.cwd()))
)).flat().sort((left, right) => right.updatedAt - left.updatedAt)
const loadDiff = (mode: DiffMode) => client.vcs.diff({
  location: { directory: process.cwd() },
  mode,
})
const initialResult = await loadDiff(DIFF_MODE.working)
const initialSettings = await loadSettings()
const initialSessions = await loadSessions()
const renderer = await createCliRenderer({ exitOnCtrlC: false })
try {
  const palette = await renderer.getPalette({ size: 16 })
  const background = palette.defaultBackground ?? palette.palette[0]
  const detectedMode = background ? (() => {
    const value = Number.parseInt(background.slice(1), 16)
    const red = (value >> 16) & 255
    const green = (value >> 8) & 255
    const blue = value & 255
    return 0.299 * red + 0.587 * green + 0.114 * blue > 127.5 ? "light" : "dark"
  })() : "dark"
  applySystemColors(palette, renderer.themeMode ?? detectedMode)
} catch {}

type CommentDraft = Omit<ReviewComment, "id" | "body" | "status" | "replies">

type PaletteCommand = {
  label: string
  keywords: string
  keybind?: readonly Keybind[]
  run: () => void
}

const nextCommentID = (comments: ReviewComment[]) => String(comments.reduce((highest, comment) => {
  if (!/^\d+$/.test(comment.id)) return highest
  const id = Number.parseInt(comment.id, 10)
  return Math.max(highest, id)
}, 0) + 1)

function App() {
  const renderer = useRenderer()
  let fileList: ScrollBoxRenderable | undefined
  let diff: DiffRenderable | undefined
  let taskList: ScrollBoxRenderable | undefined
  let paletteList: ScrollBoxRenderable | undefined
  let commentThread: ScrollBoxRenderable | undefined
  let commentEditor: TextareaRenderable | undefined
  let editing = false
  const [result, setResult] = createSignal(initialResult)
  const [sessions, setSessions] = createSignal(initialSessions)
  const [sessionQuery, setSessionQuery] = createSignal("")
  const [sessionIndex, setSessionIndex] = createSignal(0)
  const [session, setSession] = createSignal<(typeof initialSessions)[number]>()
  const [selected, setSelected] = createSignal(0)
  const [selectedDiffLine, setSelectedDiffLine] = createSignal(0)
  const [selectionAnchor, setSelectionAnchor] = createSignal<number>()
  const [commentDraft, setCommentDraft] = createSignal<CommentDraft>()
  const [editingComment, setEditingComment] = createSignal<ReviewComment>()
  const [replyingComment, setReplyingComment] = createSignal<ReviewComment>()
  const [comments, setComments] = createSignal<ReviewComment[]>([])
  const [commentsVisible, setCommentsVisible] = createSignal(false)
  const [commentListVisible, setCommentListVisible] = createSignal(false)
  const [commentListIndex, setCommentListIndex] = createSignal(0)
  const [openedComment, setOpenedComment] = createSignal<ReviewComment>()
  const [paletteVisible, setPaletteVisible] = createSignal(false)
  const [paletteQuery, setPaletteQuery] = createSignal("")
  const [paletteIndex, setPaletteIndex] = createSignal(0)
  const [errorLog, setErrorLog] = createSignal<string[]>([])
  const [errorLogVisible, setErrorLogVisible] = createSignal(false)
  const [submittingComments, setSubmittingComments] = createSignal(false)
  const [activePane, setActivePane] = createSignal<Pane>(PANE.diff)
  const [fileTreeOpen, setFileTreeOpen] = createSignal(true)
  const [mode, setMode] = createSignal<DiffMode>(DIFF_MODE.working)
  const [view, setView] = createSignal<DiffView>(initialSettings.view)
  const [wrap, setWrap] = createSignal<DiffWrap>(initialSettings.wrap)
  const [plan, setPlan] = createSignal<FeaturePlan>()
  const [planOpen, setPlanOpen] = createSignal(false)
  const [selectedPr, setSelectedPr] = createSignal(0)
  const [selectedTask, setSelectedTask] = createSignal(0)
  const [focusedPlanSection, setFocusedPlanSection] = createSignal<"prs" | "tasks">("prs")
  const current = () => result().data[selected()]
  const filteredSessions = () => {
    const query = sessionQuery().trim().toLowerCase()
    if (!query) return sessions()
    return sessions().filter((candidate) =>
      `${candidate.backend} ${candidate.availability} ${candidate.title ?? ""} ${candidate.id}`.toLowerCase().includes(query)
    )
  }
  const currentComments = () => comments().filter((comment) =>
    comment.file === current()?.file && comment.patch === current()?.patch
  )
  const selectedComments = () => currentComments().filter((comment) =>
    comment.start <= selectedDiffLine() && comment.end >= selectedDiffLine()
  )
  const displayedComments = () => openedComment() ? [openedComment()!] : selectedComments()
  const footerContext = () => {
    if (submittingComments()) return "loading" as const
    if (commentDraft() || editingComment() || replyingComment()) return "comment-editor" as const
    if (errorLogVisible()) return "error-log" as const
    if (paletteVisible()) return "command-palette" as const
    if (commentListVisible()) return "comment-list" as const
    if (commentsVisible() && displayedComments().length > 0) return "thread" as const
    return activePane()
  }
  const halfPage = () => {
    const height = activePane() === PANE.files ? fileList?.height : activePane() === PANE.plan ? taskList?.height : diff?.height
    return Math.max(Math.floor((height ?? 2) / 2), 1)
  }

  const refresh = async (nextMode = mode()) => {
    const selectedFile = current()?.file
    const next = await loadDiff(nextMode)
    const matchingIndex = next.data.findIndex((file) => file.file === selectedFile)
    const nextSelected = matchingIndex >= 0 ? matchingIndex : Math.min(selected(), Math.max(next.data.length - 1, 0))

    setResult(next)
    setSelected(nextSelected)
    setSelectionAnchor()
    if (nextMode !== mode()) setSelectedDiffLine(0)
    setMode(nextMode)
    const selectedSession = session()
    const nextPlan = selectedSession ? await loadFeaturePlan(next.location.directory, selectedSession.backend) : undefined
    setPlan(nextPlan)
    setSelectedPr((index) => Math.min(index, Math.max((nextPlan?.prs.length ?? 1) - 1, 0)))
    setSelectedTask((index) => Math.min(index, Math.max((nextPlan?.prs[selectedPr()]?.tasks.length ?? 1) - 1, 0)))
  }

  const edit = async () => {
    const selectedPlan = plan()?.prs[selectedPr()]
    const file = activePane() === PANE.plan ? selectedPlan?.path : current()?.file
    if (editing) return

    editing = true
    renderer.suspend()
    try {
      const editor = process.env.VISUAL || process.env.EDITOR || "vi"
      const path = file ? resolve(result().location.directory, file) : result().location.directory
      const taskLine = selectedPlan?.tasks[selectedTask()]?.line
      const line = !file ? undefined : activePane() === PANE.plan
        ? taskLine === undefined ? undefined : taskLine + 1
        : getDiffLineNumber(diff, current()?.patch ?? "", view(), selectedDiffLine())
      const command = [editor]
      if (["vi", "vim", "nvim"].includes(basename(editor)) && line !== undefined) command.push(`+${line}`)
      command.push(path)
      const child = Bun.spawn(command, {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      })
      await child.exited
    } finally {
      renderer.resume()
      editing = false
      await refresh()
    }
  }

  const saveComment = () => {
    const draft = commentDraft()
    const editing = editingComment()
    const replying = replyingComment()
    const text = commentEditor?.plainText.trim()
    if (!text) return
    if (replying) {
      setReplyingComment()
      void submitThreadReply(replying, text)
      return
    }
    if (editing) {
      setComments((current) => {
        const next = current.map((comment) => comment.id === editing.id ? { ...comment, body: text } : comment)
        void saveReviewComments(editing.repository, editing.sessionID, next)
        return next
      })
      setEditingComment()
      return
    }
    if (!draft) return
    setComments((current) => {
      const next = [...current, {
        ...draft,
        id: nextCommentID(current),
        body: text,
        status: "draft",
        replies: [],
      } satisfies ReviewComment]
      void saveReviewComments(draft.repository, draft.sessionID, next)
      return next
    })
    setCommentDraft()
    setSelectionAnchor()
  }

  const selectSession = async (selectedSession: NonNullable<ReturnType<typeof session>>) => {
    const repository = result().location.directory
    const [nextComments, nextPlan] = await Promise.all([
      loadReviewComments(repository, selectedSession.id),
      loadFeaturePlan(repository, selectedSession.backend),
    ])
    setComments(nextComments)
    setPlan(nextPlan)
    setSelectedPr(Math.max(nextPlan?.prs.findIndex((pr) => pr.number === nextPlan.currentPr) ?? 0, 0))
    setSelectedTask(0)
    setSession(selectedSession)
  }

  const refreshSessions = async () => {
    const selectedSession = filteredSessions()[sessionIndex()]
    const next = await loadSessions()
    const query = sessionQuery().trim().toLowerCase()
    const nextFiltered = query ? next.filter((candidate) =>
      `${candidate.backend} ${candidate.availability} ${candidate.title ?? ""} ${candidate.id}`.toLowerCase().includes(query)
    ) : next
    setSessions(next)
    setSessionIndex((index) => {
      if (selectedSession) {
        const matchingIndex = nextFiltered.findIndex((candidate) =>
          candidate.backend === selectedSession.backend && candidate.id === selectedSession.id
        )
        if (matchingIndex >= 0) return matchingIndex
      }
      return Math.min(index, Math.max(nextFiltered.length - 1, 0))
    })
  }

  const deleteComment = (target: ReviewComment) => {
    setComments((current) => {
      const next = current.filter((comment) => comment.id !== target.id)
      void saveReviewComments(target.repository, target.sessionID, next)
      return next
    })
    if (openedComment()?.id === target.id) setOpenedComment()
    setCommentListIndex((index) => Math.max(index - 1, 0))
  }

  const toggleView = () => {
    const nextView = view() === DIFF_VIEW.unified ? DIFF_VIEW.split : DIFF_VIEW.unified
    setSelectedDiffLine((line) => remapDiffLine(current()?.patch ?? "", view(), nextView, line))
    setSelectionAnchor()
    setView(nextView)
    void saveSettings({ view: nextView, wrap: wrap() })
  }

  const toggleWrap = () => {
    const nextWrap = wrap() === DIFF_WRAP.none ? DIFF_WRAP.word : DIFF_WRAP.none
    setWrap(nextWrap)
    void saveSettings({ view: view(), wrap: nextWrap })
  }

  const togglePlanSidebar = () => {
    if (planOpen()) {
      if (activePane() === PANE.plan) setActivePane(PANE.diff)
      setPlanOpen(false)
      return
    }

    const currentPr = plan()?.currentPr
    const currentIndex = plan()?.prs.findIndex((pr) => pr.number === currentPr) ?? -1
    setSelectedPr(Math.max(currentIndex, 0))
    setSelectedTask(0)
    setPlanOpen(true)
  }

  const movePane = (direction: -1 | 1) => {
    setSelectionAnchor()
    setActivePane((pane) => {
      if (direction === -1) return pane === PANE.plan ? PANE.diff : pane === PANE.diff && fileTreeOpen() ? PANE.files : pane
      return pane === PANE.files ? PANE.diff : pane === PANE.diff && planOpen() ? PANE.plan : pane
    })
  }

  const toggleFileTree = () => {
    if (fileTreeOpen() && activePane() === PANE.files) setActivePane(PANE.diff)
    setFileTreeOpen((open) => !open)
  }

  const moveToDiffChange = (direction: -1 | 1) => {
    const line = selectedDiffLine()
    const target = moveToChange(diff, current()?.patch ?? "", view(), line, direction)
    if (target !== line) {
      setSelectedDiffLine(target)
      return
    }

    const fileIndex = selected() + direction
    const file = result().data[fileIndex]
    if (!file) return
    setOpenedComment()
    setSelectionAnchor()
    setSelected(fileIndex)
    setSelectedDiffLine(getBoundaryChange(file.patch, view(), direction) ?? 0)
  }

  const recordError = (context: string, error: unknown) => {
    const detail = error instanceof Error ? error.stack ?? error.message : String(error)
    setErrorLog((current) => [...current, `${new Date().toISOString()} ${context}\n${detail}`])
  }

  const paletteCommands = (): PaletteCommand[] => [
    { label: "Refresh diff", keywords: "reload changes", keybind: KEYBINDS.refresh, run: () => void refresh() },
    { label: `Switch to ${mode() === DIFF_MODE.working ? "branch" : "working"} diff`, keywords: "mode branch working", keybind: KEYBINDS.toggleMode, run: () => void refresh(mode() === DIFF_MODE.working ? DIFF_MODE.branch : DIFF_MODE.working) },
    { label: `Switch to ${view() === DIFF_VIEW.unified ? "split" : "unified"} view`, keywords: "layout diff view", keybind: KEYBINDS.toggleView, run: toggleView },
    { label: `${wrap() === DIFF_WRAP.none ? "Enable" : "Disable"} line wrapping`, keywords: "wrap lines", keybind: KEYBINDS.toggleWrap, run: toggleWrap },
    { label: "Toggle comment markers", keywords: "show hide comments", keybind: KEYBINDS.comments, run: () => setCommentsVisible((visible) => !visible) },
    { label: "Open all comments", keywords: "review list panel", keybind: KEYBINDS.listComments, run: () => setCommentListVisible(true) },
    { label: "Reply to open thread", keywords: "follow up respond comment", keybind: KEYBINDS.replyThread, run: () => {
      const target = displayedComments()[0]
      if (target && commentsVisible()) queueMicrotask(() => setReplyingComment(target))
    } },
    { label: "Send draft comments", keywords: "agent submit review", keybind: KEYBINDS.sendComments, run: () => void submitComments() },
    { label: `View error log (${errorLog().length})`, keywords: "errors diagnostics failures", run: () => setErrorLogVisible(true) },
    { label: `${planOpen() ? "Hide" : "Show"} feature plan`, keywords: "sidebar tasks PR stack", keybind: KEYBINDS.togglePlan, run: togglePlanSidebar },
    { label: `${fileTreeOpen() ? "Hide" : "Show"} file tree`, keywords: "sidebar files", keybind: KEYBINDS.toggleFileTree, run: toggleFileTree },
    { label: "Edit current file", keywords: "editor open", keybind: KEYBINDS.edit, run: () => void edit() },
    { label: "Move to previous pane", keywords: "files diff plan focus left", keybind: KEYBINDS.previousPane, run: () => movePane(-1) },
    { label: "Move to next pane", keywords: "files diff plan focus right", keybind: KEYBINDS.nextPane, run: () => movePane(1) },
    { label: "Quit OpenDiff", keywords: "exit close", keybind: KEYBINDS.quit, run: () => renderer.destroy() },
  ]

  const filteredPaletteCommands = () => {
    const query = paletteQuery().trim().toLowerCase()
    if (!query) return paletteCommands()
    return paletteCommands().filter((command) => `${command.label} ${command.keywords}`.toLowerCase().includes(query))
  }

  createEffect(() => {
    if (!paletteVisible() || !filteredPaletteCommands()[paletteIndex()]) return
    paletteList?.scrollChildIntoView(`palette-command-${paletteIndex()}`)
  })

  const runPaletteCommand = () => {
    const command = filteredPaletteCommands()[paletteIndex()]
    if (!command) return
    setPaletteVisible(false)
    setPaletteQuery("")
    command.run()
  }

  const requestAgentReplies = async (selectedSession: NonNullable<ReturnType<typeof session>>, prompt: string) => {
    const backend = sessionBackendByName.get(selectedSession.backend)
    if (!backend) throw new Error(`Unsupported session backend: ${selectedSession.backend}`)
    const text = await backend.prompt(selectedSession, process.cwd(), prompt)
    const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].at(-1)?.[1]
    const parsed = JSON.parse(fenced ?? text) as { replies: Array<{ id: string; body: string }> }
    return new Map(parsed.replies.map((reply) => [reply.id, reply.body]))
  }

  const submitThreadReply = async (target: ReviewComment, body: string) => {
    const selectedSession = session()
    if (!selectedSession || submittingComments()) return

    const userReply = { id: crypto.randomUUID(), body, role: "user" as const }
    const submitted = comments().map((comment) => comment.id === target.id
      ? { ...comment, status: "submitted" as const, replies: [...comment.replies, userReply] }
      : comment
    )
    const submittedTarget = submitted.find((comment) => comment.id === target.id)!
    setComments(submitted)
    if (openedComment()?.id === target.id) setOpenedComment(submittedTarget)
    setSubmittingComments(true)
    try {
      await saveReviewComments(result().location.directory, selectedSession.id, submitted)
      const snippet = target.snippet ?? getDiffSnippet(target.patch, view(), target.start, target.end)
      const prompt = `Follow up on review comment ${target.id}. Address the review comment and return only JSON: {"replies":[{"id":"${target.id}","body":"your response"}]}\nFile: ${target.file}\nSelected lines:\n${snippet}\nComment: ${body}`
      const replies = await requestAgentReplies(selectedSession, prompt)
      const agentBody = replies.get(target.id)
      if (!agentBody) return
      const answered = submitted.map((comment) => comment.id === target.id
        ? {
            ...comment,
            status: "answered" as const,
            replies: [...comment.replies, { id: crypto.randomUUID(), body: agentBody, role: "assistant" as const }],
          }
        : comment
      )
      const answeredTarget = answered.find((comment) => comment.id === target.id)!
      setComments(answered)
      if (openedComment()?.id === target.id) setOpenedComment(answeredTarget)
      await saveReviewComments(result().location.directory, selectedSession.id, answered)
      await refresh()
    } catch (error) {
      recordError("Failed to submit thread reply", error)
    } finally {
      setSubmittingComments(false)
    }
  }

  const submitComments = async () => {
    const selectedSession = session()
    const drafts = comments().filter((comment) => comment.status === "draft")
    if (!selectedSession || drafts.length === 0 || submittingComments()) return

    setSubmittingComments(true)
    try {
      const submitted = comments().map((comment) =>
        comment.status === "draft" ? { ...comment, status: "submitted" as const } : comment
      )
      setComments(submitted)
      await saveReviewComments(result().location.directory, selectedSession.id, submitted)

      const prompt = `Address these review comments and return only JSON with one reply per ID: {"replies":[{"id":"comment-id","body":"summary"}]}\n\n${drafts.map((comment) => `${comment.id} ${comment.file}\n${comment.snippet ?? getDiffSnippet(comment.patch, view(), comment.start, comment.end)}\nComment: ${comment.body}`).join("\n\n")}`
      const replies = await requestAgentReplies(selectedSession, prompt)
      const answered = submitted.map((comment) => {
        const body = replies.get(comment.id)
        if (!body) return comment
        return {
          ...comment,
          status: "answered" as const,
          replies: [...comment.replies, { id: crypto.randomUUID(), body, role: "assistant" as const }],
        }
      })
      setComments(answered)
      await saveReviewComments(result().location.directory, selectedSession.id, answered)
      await refresh()
    } catch (error) {
      recordError("Failed to submit review comments", error)
    } finally {
      setSubmittingComments(false)
    }
  }

  createEffect(() => {
    const line = selectedDiffLine()
    const anchor = selectionAnchor() ?? line
    current()?.patch
    view()
    wrap()
    queueMicrotask(() => queueMicrotask(() => highlightDiffRange(diff, anchor, line, COLORS.selection)))
  })

  createEffect(() => {
    const visible = commentsVisible()
    const ranges = visible ? currentComments() : []
    view()
    wrap()
    queueMicrotask(() => queueMicrotask(() => markDiffComments(diff, ranges, COLORS.comment)))
  })

  useKeyboard((key) => {
    const pressed = (bindings: readonly Keybind[]) =>
      bindings.some((binding) => binding.name === key.name && Boolean(binding.ctrl) === key.ctrl)

    if (pressed(KEYBINDS.nextChange)) {
      key.preventDefault()
      key.stopPropagation()
      moveToDiffChange(1)
      return
    }
    if (pressed(KEYBINDS.previousChange)) {
      key.preventDefault()
      key.stopPropagation()
      moveToDiffChange(-1)
      return
    }
    if (commentDraft() || editingComment() || replyingComment()) {
      if (key.name === "escape") {
        setCommentDraft()
        setEditingComment()
        setReplyingComment()
      }
      return
    }
    if (errorLogVisible()) {
      if (key.name === "escape") setErrorLogVisible(false)
      return
    }
    if (paletteVisible()) {
      if (key.name === "escape" || pressed(KEYBINDS.commandPalette)) {
        setPaletteVisible(false)
        setPaletteQuery("")
      } else if (key.name === "down") {
        key.preventDefault()
        setPaletteIndex((index) => Math.min(index + 1, Math.max(filteredPaletteCommands().length - 1, 0)))
      } else if (key.name === "up") {
        key.preventDefault()
        setPaletteIndex((index) => Math.max(index - 1, 0))
      } else if (pressed(KEYBINDS.select)) {
        key.preventDefault()
        runPaletteCommand()
      }
      return
    }
    if (session() && pressed(KEYBINDS.commandPalette)) {
      key.preventDefault()
      key.stopPropagation()
      setPaletteIndex(0)
      queueMicrotask(() => setPaletteVisible(true))
      return
    }
    if (session() && pressed(KEYBINDS.sendComments)) {
      void submitComments()
      return
    }
    if (commentListVisible()) {
      if (key.name === "escape" || pressed(KEYBINDS.listComments)) setCommentListVisible(false)
      if (pressed(KEYBINDS.down)) {
        setCommentListIndex((index) => Math.min(index + 1, Math.max(comments().length - 1, 0)))
      }
      if (pressed(KEYBINDS.up)) setCommentListIndex((index) => Math.max(index - 1, 0))
      if (pressed(KEYBINDS.editComment)) {
        const editable = comments()[commentListIndex()]
        if (editable?.status === "draft") queueMicrotask(() => setEditingComment(editable))
      }
      if (pressed(KEYBINDS.deleteComment)) {
        const target = comments()[commentListIndex()]
        if (target) deleteComment(target)
      }
      if (pressed(KEYBINDS.select)) {
        const target = comments()[commentListIndex()]
        const fileIndex = target
          ? result().data.findIndex((file) => file.file === target.file && file.patch === target.patch)
          : -1
        const fallbackIndex = target ? result().data.findIndex((file) => file.file === target.file) : -1
        const targetIndex = fileIndex >= 0 ? fileIndex : fallbackIndex
        if (target) {
          if (targetIndex >= 0) {
            setSelected(targetIndex)
            setSelectedDiffLine(target.start)
            setSelectionAnchor()
            setActivePane(PANE.diff)
          }
          setCommentsVisible(true)
          setOpenedComment(target)
          setCommentListVisible(false)
        }
      }
      return
    }
    if (openedComment() && commentsVisible()) {
      if (pressed(KEYBINDS.down)) {
        key.preventDefault()
        key.stopPropagation()
        commentThread?.scrollBy(1 / 5, "viewport")
        return
      }
      if (pressed(KEYBINDS.up)) {
        key.preventDefault()
        key.stopPropagation()
        commentThread?.scrollBy(-1 / 5, "viewport")
        return
      }
      if (pressed(KEYBINDS.pageDown)) {
        key.preventDefault()
        key.stopPropagation()
        commentThread?.scrollBy(1 / 2, "viewport")
        return
      }
      if (pressed(KEYBINDS.pageUp)) {
        key.preventDefault()
        key.stopPropagation()
        commentThread?.scrollBy(-1 / 2, "viewport")
        return
      }
    }
    if (selectionAnchor() !== undefined && key.name === "escape") {
      setSelectionAnchor()
      return
    }
    if (commentsVisible() && key.name === "escape") {
      setCommentsVisible(false)
      setOpenedComment()
      return
    }
    if (session() ? pressed(KEYBINDS.quit) : pressed(KEYBINDS.quitSessionPicker)) {
      renderer.destroy()
      return
    }
    if (!session()) {
      if (pressed(KEYBINDS.refreshSessions)) {
        key.preventDefault()
        void refreshSessions()
        return
      }
      if (key.name === "down") {
        key.preventDefault()
        setSessionIndex((index) => Math.min(index + 1, Math.max(filteredSessions().length - 1, 0)))
      }
      if (key.name === "up") {
        key.preventDefault()
        setSessionIndex((index) => Math.max(index - 1, 0))
      }
      if (pressed(KEYBINDS.select)) {
        key.preventDefault()
        const selectedSession = filteredSessions()[sessionIndex()]
        if (selectedSession) void selectSession(selectedSession)
      }
      return
    }
    if (pressed(KEYBINDS.edit)) {
      key.preventDefault()
      key.stopPropagation()
      void edit()
      return
    }
    if (pressed(KEYBINDS.previousPane)) {
      key.preventDefault()
      key.stopPropagation()
      movePane(-1)
      return
    }
    if (pressed(KEYBINDS.nextPane)) {
      key.preventDefault()
      key.stopPropagation()
      movePane(1)
      return
    }
    if (activePane() === PANE.plan && pressed(KEYBINDS.switchSection)) {
      key.preventDefault()
      key.stopPropagation()
      setFocusedPlanSection((section) => section === "prs" ? "tasks" : "prs")
      return
    }
    if (pressed(KEYBINDS.togglePlan)) {
      togglePlanSidebar()
      return
    }
    if (pressed(KEYBINDS.toggleFileTree)) {
      toggleFileTree()
      return
    }
    if (activePane() === PANE.plan && pressed(KEYBINDS.toggleTask)) {
      const selectedPlan = plan()?.prs[selectedPr()]
      if (selectedPlan) void togglePlanTask(result().location.directory, selectedPlan, selectedTask()).then(() => refresh())
      return
    }
    if (activePane() === PANE.files && pressed(KEYBINDS.select)) {
      setActivePane(PANE.diff)
      return
    }
    if (pressed(KEYBINDS.down)) {
      setOpenedComment()
      if (activePane() === PANE.files) {
        setSelected((index) => Math.min(index + 1, Math.max(result().data.length - 1, 0)))
        setSelectedDiffLine(0)
        setSelectionAnchor()
      } else if (activePane() === PANE.diff) {
        setSelectedDiffLine((line) => moveDiffSelection(diff, line, 1))
      } else if (focusedPlanSection() === "tasks") {
        setSelectedTask((index) => Math.min(index + 1, Math.max((plan()?.prs[selectedPr()]?.tasks.length ?? 1) - 1, 0)))
      } else {
        setSelectedPr((index) => Math.min(index + 1, Math.max((plan()?.prs.length ?? 1) - 1, 0)))
        setSelectedTask(0)
      }
    }
    if (pressed(KEYBINDS.up)) {
      setOpenedComment()
      if (activePane() === PANE.files) {
        setSelected((index) => Math.max(index - 1, 0))
        setSelectedDiffLine(0)
        setSelectionAnchor()
      } else if (activePane() === PANE.diff) {
        setSelectedDiffLine((line) => moveDiffSelection(diff, line, -1))
      } else if (focusedPlanSection() === "tasks") {
        setSelectedTask((index) => Math.max(index - 1, 0))
      } else {
        setSelectedPr((index) => Math.max(index - 1, 0))
        setSelectedTask(0)
      }
    }
    if (pressed(KEYBINDS.pageDown)) {
      setOpenedComment()
      if (activePane() === PANE.files) {
        setSelected((index) => Math.min(index + halfPage(), Math.max(result().data.length - 1, 0)))
        setSelectedDiffLine(0)
        setSelectionAnchor()
      } else if (activePane() === PANE.diff) {
        setSelectedDiffLine((line) => moveDiffSelectionByVisualRows(diff, line, halfPage()))
      } else {
        setSelectedTask((index) => Math.min(index + halfPage(), Math.max((plan()?.prs[selectedPr()]?.tasks.length ?? 1) - 1, 0)))
      }
    }
    if (pressed(KEYBINDS.pageUp)) {
      setOpenedComment()
      if (activePane() === PANE.files) {
        setSelected((index) => Math.max(index - halfPage(), 0))
        setSelectedDiffLine(0)
        setSelectionAnchor()
      } else if (activePane() === PANE.diff) {
        setSelectedDiffLine((line) => moveDiffSelectionByVisualRows(diff, line, -halfPage()))
      } else {
        setSelectedTask((index) => Math.max(index - halfPage(), 0))
      }
    }
    if (activePane() === PANE.diff && pressed(KEYBINDS.visual)) {
      setSelectionAnchor((anchor) => anchor === undefined ? selectedDiffLine() : undefined)
    }
    if (pressed(KEYBINDS.replyThread)) {
      const target = displayedComments()[0]
      if (commentsVisible() && target) {
        key.preventDefault()
        key.stopPropagation()
        queueMicrotask(() => setReplyingComment(target))
      }
    }
    if (activePane() === PANE.diff && pressed(KEYBINDS.comment)) {
      key.preventDefault()
      key.stopPropagation()
      const selectedSession = session()
      const file = current()
      if (selectedSession && file) {
        const line = selectedDiffLine()
        const anchor = selectionAnchor() ?? line
        const draft = {
          repository: result().location.directory,
          sessionID: selectedSession.id,
          file: file.file,
          patch: file.patch,
          snippet: getDiffSnippet(file.patch, view(), Math.min(anchor, line), Math.max(anchor, line)),
          start: Math.min(anchor, line),
          end: Math.max(anchor, line),
        }
        queueMicrotask(() => setCommentDraft(draft))
      }
    }
    if (pressed(KEYBINDS.comments)) {
      setOpenedComment()
      setCommentsVisible((visible) => !visible)
    }
    if (pressed(KEYBINDS.listComments)) {
      setCommentListIndex((index) => Math.min(index, Math.max(comments().length - 1, 0)))
      setCommentListVisible(true)
    }
    if (activePane() === PANE.diff && pressed(KEYBINDS.editComment)) {
      const editable = selectedComments().find((comment) => comment.status === "draft")
      if (editable) queueMicrotask(() => setEditingComment(editable))
    }
    if (commentsVisible() && pressed(KEYBINDS.deleteComment)) {
      const target = displayedComments()[0]
      if (target) deleteComment(target)
    }
    if (pressed(KEYBINDS.refresh)) {
      void refresh()
    }
    if (pressed(KEYBINDS.toggleMode)) {
      void refresh(mode() === DIFF_MODE.working ? DIFF_MODE.branch : DIFF_MODE.working)
    }
    if (pressed(KEYBINDS.toggleView)) {
      toggleView()
    }
    if (pressed(KEYBINDS.toggleWrap)) {
      toggleWrap()
    }
  })

  return (
    <Show
      when={session()}
      fallback={
        <SessionPicker
          directory={process.cwd()}
          sessions={filteredSessions()}
          selected={sessionIndex()}
          query={sessionQuery()}
          onQuery={(query) => {
            setSessionQuery(query)
            setSessionIndex(0)
          }}
        />
      }
    >
      <box flexDirection="column" width="100%" height="100%" backgroundColor={COLORS.canvas}>
      <box height={1} paddingLeft={1} paddingRight={1} backgroundColor={COLORS.panel}>
        <text fg={COLORS.text}>
          <b>opendiff</b>  {result().location.directory}  [{session()?.title ?? session()?.id}]  [{mode()}, {view()}, {wrap()}]  [{comments().length} comments, {commentsVisible() ? "shown" : "hidden"}]{submittingComments() ? "  [sending]" : ""}{selectionAnchor() === undefined ? "" : "  [visual]"}
        </text>
      </box>

      <box flexDirection="row" flexGrow={1}>
        {result().data.length === 0 ? (
          <box flexGrow={1} alignItems="center" justifyContent="center">
            <text fg={COLORS.textMuted}>No {mode()} changes</text>
          </box>
        ) : (
          <box flexDirection="row" flexGrow={1}>
            <Show when={fileTreeOpen()}>
              <FileTree
                active={activePane() === PANE.files}
                files={result().data}
                selected={selected()}
                onReady={(element) => (fileList = element)}
              />
            </Show>
            <DiffPane
              activePane={activePane()}
              file={current()}
              view={view()}
              wrap={wrap()}
              onReady={(element) => {
                diff = element
                const line = selectedDiffLine()
                highlightDiffRange(diff, selectionAnchor() ?? line, line, COLORS.selection)
                markDiffComments(diff, commentsVisible() ? currentComments() : [], COLORS.comment)
              }}
            />
          </box>
        )}
        <Show when={planOpen()}>
          <PlanSidebar
            active={activePane() === PANE.plan}
            plan={plan()}
            selectedPr={selectedPr()}
            selectedTask={selectedTask()}
            focusedSection={focusedPlanSection()}
            onReady={(element) => (taskList = element)}
          />
        </Show>
      </box>

      <Footer context={footerContext()} />
      <Show when={errorLogVisible()}>
        <box
          position="absolute"
          top={0}
          left={0}
          width="100%"
          height="100%"
          alignItems="center"
          justifyContent="center"
        >
          <box
            width="80%"
            height="70%"
            padding={1}
            flexDirection="column"
            borderStyle="single"
            borderColor={COLORS.removed}
            backgroundColor={COLORS.panel}
          >
            <text fg={COLORS.textStrong}><b>Error log</b></text>
            <text fg={COLORS.textMuted}>{errorLog().length} errors</text>
            <scrollbox flexGrow={1} scrollX={false} scrollY>
              <Show when={errorLog().length > 0} fallback={<text fg={COLORS.textMuted}>No errors recorded</text>}>
                <For each={errorLog()}>
                  {(error) => (
                    <box marginTop={1} paddingLeft={1} border={["left"]} borderStyle="single" borderColor={COLORS.removed}>
                      <text fg={COLORS.text}>{error}</text>
                    </box>
                  )}
                </For>
              </Show>
            </scrollbox>
            <text fg={COLORS.textMuted}>esc close</text>
          </box>
        </box>
      </Show>
      <Show when={submittingComments()}>
        <box
          position="absolute"
          top={0}
          left={0}
          width="100%"
          height="100%"
          alignItems="center"
          justifyContent="center"
        >
          <box
            width="50%"
            maxWidth={64}
            height={7}
            padding={1}
            flexDirection="column"
            alignItems="center"
            justifyContent="center"
            borderStyle="single"
            borderColor={COLORS.syntaxProperty}
            backgroundColor={COLORS.panel}
          >
            <text fg={COLORS.syntaxProperty}><b>Agent is working...</b></text>
            <text fg={COLORS.text}>Waiting for the review response</text>
            <text fg={COLORS.textMuted}>Comments were sent to {session()?.title ?? session()?.id}</text>
          </box>
        </box>
      </Show>
      <Show when={paletteVisible()}>
        <box
          position="absolute"
          top={0}
          left={0}
          width="100%"
          height="100%"
          alignItems="center"
          justifyContent="center"
        >
          <box
            width="60%"
            maxWidth={72}
            height={16}
            padding={1}
            flexDirection="column"
            borderStyle="single"
            borderColor={COLORS.selection}
            backgroundColor={COLORS.panel}
          >
            <text fg={COLORS.textStrong}><b>Command palette</b></text>
            <input
              focused
              placeholder="Search commands"
              value={paletteQuery()}
              textColor={COLORS.text}
              backgroundColor={COLORS.canvas}
              focusedTextColor={COLORS.text}
              focusedBackgroundColor={COLORS.canvas}
              onInput={(value) => {
                setPaletteQuery(value)
                setPaletteIndex(0)
              }}
            />
            <scrollbox
              ref={(element) => (paletteList = element)}
              flexGrow={1}
              marginTop={1}
              scrollX={false}
              scrollY
            >
              <Show when={filteredPaletteCommands().length > 0} fallback={<text fg={COLORS.textMuted}>No matching commands</text>}>
                <For each={filteredPaletteCommands()}>
                  {(command, index) => (
                    <box
                      id={`palette-command-${index()}`}
                      width="100%"
                      height={1}
                      flexDirection="row"
                      justifyContent="space-between"
                      paddingLeft={1}
                      paddingRight={1}
                      backgroundColor={index() === paletteIndex() ? COLORS.selection : COLORS.panel}
                    >
                      <text fg={COLORS.text}>{command.label}</text>
                      <Show when={command.keybind}>
                        {(keybind) => <text fg={index() === paletteIndex() ? COLORS.text : COLORS.textMuted}>{keybind().map(formatKeybind).join("/")}</text>}
                      </Show>
                    </box>
                  )}
                </For>
              </Show>
            </scrollbox>
          </box>
        </box>
      </Show>
      <Show when={commentDraft() || editingComment() || replyingComment()}>
        <box
          position="absolute"
          top={0}
          left={0}
          width="100%"
          height="100%"
          alignItems="center"
          justifyContent="center"
        >
          <box
            width="70%"
            maxWidth={100}
            height="50%"
            maxHeight={20}
            padding={1}
            flexDirection="column"
            borderStyle="single"
            borderColor={COLORS.comment}
            backgroundColor={COLORS.panel}
          >
            <text fg={COLORS.textStrong}>
              <b>{replyingComment() ? "Reply to review thread" : editingComment() ? "Edit review comment" : "Add review comment"}</b>
            </text>
            <text fg={COLORS.textMuted}>
              {(commentDraft() ?? editingComment() ?? replyingComment())?.file} rows {((commentDraft() ?? editingComment() ?? replyingComment())?.start ?? 0) + 1}-{((commentDraft() ?? editingComment() ?? replyingComment())?.end ?? 0) + 1}
            </text>
            <textarea
              ref={(element) => {
                commentEditor = element
                element.initialValue = editingComment()?.body ?? ""
              }}
              focused
              placeholder={replyingComment() ? "Write a follow-up" : "Write a review comment"}
              flexGrow={1}
              wrapMode="word"
              textColor={COLORS.text}
              backgroundColor={COLORS.canvas}
              focusedTextColor={COLORS.text}
              focusedBackgroundColor={COLORS.canvas}
              keyBindings={[
                { name: "return", action: "submit" },
                { name: "return", shift: true, action: "newline" },
              ]}
              onSubmit={saveComment}
            />
            <text fg={COLORS.textMuted}>enter submit  S-enter newline  esc cancel</text>
          </box>
        </box>
      </Show>
      <Show when={commentListVisible()}>
        <box
          position="absolute"
          top={1}
          right={0}
          bottom={1}
          width="50%"
          maxWidth={80}
          padding={1}
          flexDirection="column"
          borderStyle="single"
          borderColor={COLORS.selection}
          backgroundColor={COLORS.panel}
        >
          <text fg={COLORS.textStrong}><b>All review comments</b></text>
          <text fg={COLORS.textMuted}>{comments().length} comments  j/k select  i edit draft  d delete  esc close</text>
          <scrollbox flexGrow={1} scrollX={false} scrollY>
            <Show when={comments().length > 0} fallback={<text fg={COLORS.textMuted}>No review comments</text>}>
              <For each={comments()}>
                {(comment, index) => (
                  <box
                    flexDirection="column"
                    paddingLeft={1}
                    paddingRight={1}
                    marginTop={1}
                    backgroundColor={index() === commentListIndex() ? COLORS.selection : COLORS.canvas}
                  >
                    <text fg={COLORS.textMuted}>{comment.file}:{comment.start + 1}-{comment.end + 1}  [{comment.status}]</text>
                    <text fg={COLORS.text}>{comment.body}</text>
                    <Show when={index() === commentListIndex()}>
                      <For each={comment.replies}>
                        {(reply) => (
                          <box
                            flexDirection="column"
                            border={["left"]}
                            borderStyle="single"
                            borderColor={reply.role === "assistant" ? COLORS.syntaxProperty : COLORS.comment}
                            paddingLeft={1}
                            marginTop={1}
                          >
                            <text fg={reply.role === "assistant" ? COLORS.syntaxProperty : COLORS.comment}>
                              <b>{reply.role === "assistant" ? "Agent" : "You"}</b>
                            </text>
                            <text fg={COLORS.text}>{reply.body}</text>
                          </box>
                        )}
                      </For>
                    </Show>
                  </box>
                )}
              </For>
            </Show>
          </scrollbox>
        </box>
      </Show>
      <Show when={!commentListVisible() && commentsVisible() && displayedComments().length > 0}>
        <box
          position="absolute"
          top={2}
          right={1}
          width="35%"
          maxWidth={56}
          height="40%"
          maxHeight={16}
          padding={1}
          flexDirection="column"
          overflow="hidden"
          borderStyle="single"
          borderColor={COLORS.comment}
          backgroundColor={COLORS.panel}
        >
          <text flexShrink={0} fg={COLORS.textStrong}><b>Review comments</b></text>
          <scrollbox
            ref={(element) => (commentThread = element)}
            flexGrow={1}
            overflow="hidden"
            scrollX={false}
            scrollY
          >
            <For each={displayedComments()}>
              {(comment) => (
                <box flexDirection="column" marginBottom={1}>
                  <text fg={COLORS.textMuted}>{comment.file}:{comment.start + 1}-{comment.end + 1}</text>
                  <box
                    flexDirection="column"
                    border={["left"]}
                    borderStyle="single"
                    borderColor={COLORS.comment}
                    paddingLeft={1}
                  >
                    <text fg={COLORS.comment}><b>You</b></text>
                    <text fg={COLORS.text}>{comment.body}</text>
                  </box>
                  <For each={comment.replies}>
                    {(reply) => (
                      <box
                        flexDirection="column"
                        border={["left"]}
                        borderStyle="single"
                        borderColor={reply.role === "assistant" ? COLORS.syntaxProperty : COLORS.comment}
                        paddingLeft={1}
                        marginTop={1}
                      >
                        <text fg={reply.role === "assistant" ? COLORS.syntaxProperty : COLORS.comment}>
                          <b>{reply.role === "assistant" ? "Agent" : "You"}</b>
                        </text>
                        <text fg={COLORS.text}>{reply.body}</text>
                      </box>
                    )}
                  </For>
                </box>
              )}
            </For>
          </scrollbox>
          <text flexShrink={0} fg={COLORS.textMuted}>j/k scroll  C-d/C-u page  f reply  esc hide</text>
        </box>
      </Show>
      </box>
    </Show>
  )
}

await render(() => <App />, renderer)
