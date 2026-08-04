#!/usr/bin/env bun

import { OpenCode } from "@opencode-ai/client"
import { Service } from "@opencode-ai/client/service"
import type { DiffRenderable, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { render, useKeyboard, useRenderer } from "@opentui/solid"
import { basename, resolve } from "node:path"
import { createEffect, createSignal, For, Show } from "solid-js"
import { DiffPane } from "./components/diff-pane"
import { FileTree } from "./components/file-tree"
import { Footer } from "./components/footer"
import { SessionPicker } from "./components/session-picker"
import {
  COLORS,
  DIFF_MODE,
  DIFF_VIEW,
  DIFF_WRAP,
  KEYBINDS,
  PANE,
  type DiffMode,
  type DiffView,
  type DiffWrap,
  type Keybind,
  type Pane,
} from "./config"
import {
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

const endpoint = await Service.ensure()
const client = OpenCode.make({
  baseUrl: endpoint.url,
  headers: Service.headers(endpoint),
})
const loadDiff = (mode: DiffMode) => client.vcs.diff({
  location: { directory: process.cwd() },
  mode,
})
const initialResult = await loadDiff(DIFF_MODE.working)
const initialSettings = await loadSettings()
const initialSessions = await client.session.list({
  directory: process.cwd(),
  order: "desc",
})

type CommentDraft = Omit<ReviewComment, "id" | "body" | "status" | "replies">

function App() {
  const renderer = useRenderer()
  let fileList: ScrollBoxRenderable | undefined
  let diff: DiffRenderable | undefined
  let commentEditor: TextareaRenderable | undefined
  let editing = false
  const [result, setResult] = createSignal(initialResult)
  const [sessionIndex, setSessionIndex] = createSignal(0)
  const [session, setSession] = createSignal<(typeof initialSessions.data)[number]>()
  const [selected, setSelected] = createSignal(0)
  const [selectedDiffLine, setSelectedDiffLine] = createSignal(0)
  const [selectionAnchor, setSelectionAnchor] = createSignal<number>()
  const [commentDraft, setCommentDraft] = createSignal<CommentDraft>()
  const [editingComment, setEditingComment] = createSignal<ReviewComment>()
  const [comments, setComments] = createSignal<ReviewComment[]>([])
  const [commentsVisible, setCommentsVisible] = createSignal(false)
  const [commentListVisible, setCommentListVisible] = createSignal(false)
  const [commentListIndex, setCommentListIndex] = createSignal(0)
  const [submittingComments, setSubmittingComments] = createSignal(false)
  const [activePane, setActivePane] = createSignal<Pane>(PANE.diff)
  const [mode, setMode] = createSignal<DiffMode>(DIFF_MODE.working)
  const [view, setView] = createSignal<DiffView>(initialSettings.view)
  const [wrap, setWrap] = createSignal<DiffWrap>(initialSettings.wrap)
  const current = () => result().data[selected()]
  const currentComments = () => comments().filter((comment) =>
    comment.file === current()?.file && comment.patch === current()?.patch
  )
  const selectedComments = () => currentComments().filter((comment) =>
    comment.start <= selectedDiffLine() && comment.end >= selectedDiffLine()
  )
  const halfPage = () => {
    const height = activePane() === PANE.files ? fileList?.height : diff?.height
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
  }

  const edit = async () => {
    const file = current()?.file
    if (!file || editing) return

    editing = true
    renderer.suspend()
    try {
      const editor = process.env.VISUAL || process.env.EDITOR || "vi"
      const path = resolve(result().location.directory, file)
      const line = getDiffLineNumber(diff, current()?.patch ?? "", view(), selectedDiffLine())
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
    const text = commentEditor?.plainText.trim()
    if (!text) return
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
        id: crypto.randomUUID(),
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
    setComments(await loadReviewComments(repository, selectedSession.id))
    setSession(selectedSession)
  }

  const submitComments = async () => {
    const selectedSession = session()
    const drafts = comments().filter((comment) => comment.status === "draft")
    if (!selectedSession || drafts.length === 0 || submittingComments()) return

    setSubmittingComments(true)
    const submitted = comments().map((comment) =>
      comment.status === "draft" ? { ...comment, status: "submitted" as const } : comment
    )
    setComments(submitted)
    await saveReviewComments(result().location.directory, selectedSession.id, submitted)

    const prompt = `Address these diff review comments. Each comment has a stable ID. Make the requested code changes, then respond with only JSON in the form {"replies":[{"id":"comment-id","body":"summary of what you did"}]} using one reply for every comment.\n\n${drafts.map((comment) => `COMMENT ${comment.id}\nFile: ${comment.file}\nDiff rows: ${comment.start + 1}-${comment.end + 1}\nComment: ${comment.body}\nPatch:\n${comment.patch}`).join("\n\n")}`
    const pending = await client.session.prompt({ sessionID: selectedSession.id, text: prompt })
    await client.session.wait({ sessionID: selectedSession.id })
    const messages = await client.message.list({ sessionID: selectedSession.id, order: "desc", limit: 20 })
    const response = messages.data.find((message) =>
      message.type === "assistant" && message.time.created >= pending.timeCreated
    )
    const text = response?.type === "assistant"
      ? response.content.filter((part) => part.type === "text").map((part) => part.text).join("")
      : ""
    const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].at(-1)?.[1]
    const parsed = JSON.parse(fenced ?? text) as { replies: Array<{ id: string; body: string }> }
    const replies = new Map(parsed.replies.map((reply) => [reply.id, reply.body]))
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
    setSubmittingComments(false)
    await refresh()
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

    if (commentDraft() || editingComment()) {
      if (key.name === "escape") {
        setCommentDraft()
        setEditingComment()
      }
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
      return
    }
    if (selectionAnchor() !== undefined && key.name === "escape") {
      setSelectionAnchor()
      return
    }
    if (commentsVisible() && key.name === "escape") {
      setCommentsVisible(false)
      return
    }
    if (pressed(KEYBINDS.quit)) {
      renderer.destroy()
      return
    }
    if (!session()) {
      if (pressed(KEYBINDS.down)) {
        setSessionIndex((index) => Math.min(index + 1, Math.max(initialSessions.data.length - 1, 0)))
      }
      if (pressed(KEYBINDS.up)) {
        setSessionIndex((index) => Math.max(index - 1, 0))
      }
      if (pressed(KEYBINDS.select)) {
        const selectedSession = initialSessions.data[sessionIndex()]
        if (selectedSession) void selectSession(selectedSession)
      }
      return
    }
    if (pressed(KEYBINDS.switchPane)) {
      key.preventDefault()
      key.stopPropagation()
      setSelectionAnchor()
      setActivePane((pane) => pane === PANE.files ? PANE.diff : PANE.files)
      return
    }
    if (activePane() === PANE.files && pressed(KEYBINDS.select)) {
      setActivePane(PANE.diff)
      return
    }
    if (pressed(KEYBINDS.down)) {
      if (activePane() === PANE.files) {
        setSelected((index) => Math.min(index + 1, Math.max(result().data.length - 1, 0)))
        setSelectedDiffLine(0)
        setSelectionAnchor()
      } else {
        setSelectedDiffLine((line) => moveDiffSelection(diff, line, 1))
      }
    }
    if (pressed(KEYBINDS.up)) {
      if (activePane() === PANE.files) {
        setSelected((index) => Math.max(index - 1, 0))
        setSelectedDiffLine(0)
        setSelectionAnchor()
      } else {
        setSelectedDiffLine((line) => moveDiffSelection(diff, line, -1))
      }
    }
    if (pressed(KEYBINDS.pageDown)) {
      if (activePane() === PANE.files) {
        setSelected((index) => Math.min(index + halfPage(), Math.max(result().data.length - 1, 0)))
        setSelectedDiffLine(0)
        setSelectionAnchor()
      } else {
        setSelectedDiffLine((line) => moveDiffSelectionByVisualRows(diff, line, halfPage()))
      }
    }
    if (pressed(KEYBINDS.pageUp)) {
      if (activePane() === PANE.files) {
        setSelected((index) => Math.max(index - halfPage(), 0))
        setSelectedDiffLine(0)
        setSelectionAnchor()
      } else {
        setSelectedDiffLine((line) => moveDiffSelectionByVisualRows(diff, line, -halfPage()))
      }
    }
    if (activePane() === PANE.diff && pressed(KEYBINDS.nextChange)) {
      setSelectedDiffLine((line) => moveToChange(diff, current()?.patch ?? "", view(), line, 1))
    }
    if (activePane() === PANE.diff && pressed(KEYBINDS.previousChange)) {
      setSelectedDiffLine((line) => moveToChange(diff, current()?.patch ?? "", view(), line, -1))
    }
    if (activePane() === PANE.diff && pressed(KEYBINDS.visual)) {
      setSelectionAnchor((anchor) => anchor === undefined ? selectedDiffLine() : undefined)
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
          start: Math.min(anchor, line),
          end: Math.max(anchor, line),
        }
        queueMicrotask(() => setCommentDraft(draft))
      }
    }
    if (pressed(KEYBINDS.comments)) {
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
    if (pressed(KEYBINDS.sendComments)) {
      void submitComments()
    }
    if (pressed(KEYBINDS.refresh)) {
      void refresh()
    }
    if (pressed(KEYBINDS.toggleMode)) {
      void refresh(mode() === DIFF_MODE.working ? DIFF_MODE.branch : DIFF_MODE.working)
    }
    if (pressed(KEYBINDS.edit)) {
      void edit()
    }
    if (pressed(KEYBINDS.toggleView)) {
      const nextView = view() === DIFF_VIEW.unified ? DIFF_VIEW.split : DIFF_VIEW.unified
      setSelectedDiffLine((line) => remapDiffLine(current()?.patch ?? "", view(), nextView, line))
      setSelectionAnchor()
      setView(nextView)
      void saveSettings({ view: nextView, wrap: wrap() })
    }
    if (pressed(KEYBINDS.toggleWrap)) {
      const nextWrap = wrap() === DIFF_WRAP.none ? DIFF_WRAP.word : DIFF_WRAP.none
      setWrap(nextWrap)
      void saveSettings({ view: view(), wrap: nextWrap })
    }
  })

  return (
    <Show
      when={session()}
      fallback={
        <SessionPicker
          directory={process.cwd()}
          sessions={initialSessions.data}
          selected={sessionIndex()}
        />
      }
    >
      <box flexDirection="column" width="100%" height="100%" backgroundColor={COLORS.canvas}>
      <box height={1} paddingLeft={1} paddingRight={1} backgroundColor={COLORS.panel}>
        <text fg={COLORS.text}>
          <b>opendiff</b>  {result().location.directory}  [{session()?.title ?? session()?.id}]  [{mode()}, {view()}, {wrap()}]  [{comments().length} comments, {commentsVisible() ? "shown" : "hidden"}]{submittingComments() ? "  [sending]" : ""}{selectionAnchor() === undefined ? "" : "  [visual]"}
        </text>
      </box>

      {result().data.length === 0 ? (
        <box flexGrow={1} alignItems="center" justifyContent="center">
          <text fg={COLORS.textMuted}>No {mode()} changes</text>
        </box>
      ) : (
        <box flexDirection="row" flexGrow={1}>
          <FileTree
            active={activePane() === PANE.files}
            files={result().data}
            selected={selected()}
            onReady={(element) => (fileList = element)}
          />
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

      <Footer activePane={activePane()} />
      <Show when={commentDraft() || editingComment()}>
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
            <text fg={COLORS.textStrong}><b>{editingComment() ? "Edit review comment" : "Add review comment"}</b></text>
            <text fg={COLORS.textMuted}>
              {(commentDraft() ?? editingComment())?.file} rows {((commentDraft() ?? editingComment())?.start ?? 0) + 1}-{((commentDraft() ?? editingComment())?.end ?? 0) + 1}
            </text>
            <textarea
              ref={(element) => {
                commentEditor = element
                element.initialValue = editingComment()?.body ?? ""
              }}
              focused
              placeholder="Write a review comment"
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
          <text fg={COLORS.textMuted}>{comments().length} comments  j/k select  i edit draft  esc close</text>
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
      <Show when={!commentListVisible() && commentsVisible() && selectedComments().length > 0}>
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
          borderStyle="single"
          borderColor={COLORS.comment}
          backgroundColor={COLORS.panel}
        >
          <text fg={COLORS.textStrong}><b>Review comments</b></text>
          <scrollbox flexGrow={1} scrollX={false} scrollY>
            <For each={selectedComments()}>
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
          <text fg={COLORS.textMuted}>esc hide</text>
        </box>
      </Show>
      </box>
    </Show>
  )
}

await render(() => <App />, { exitOnCtrlC: false })
