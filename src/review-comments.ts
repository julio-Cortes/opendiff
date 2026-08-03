import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export type ReviewComment = {
  id: string
  repository: string
  sessionID: string
  file: string
  patch: string
  start: number
  end: number
  body: string
  status: "draft" | "submitted" | "answered"
  reply?: string
}

const commentsPath = join(
  process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
  "opendiff",
  "comments.json",
)

async function loadAllComments() {
  const file = Bun.file(commentsPath)
  if (!(await file.exists())) return []
  return file.json() as Promise<ReviewComment[]>
}

export async function loadReviewComments(repository: string, sessionID: string) {
  const comments = await loadAllComments()
  return comments.filter((comment) => comment.repository === repository && comment.sessionID === sessionID)
}

export async function saveReviewComments(repository: string, sessionID: string, comments: ReviewComment[]) {
  const stored = await loadAllComments()
  const remaining = stored.filter((comment) =>
    comment.repository !== repository || comment.sessionID !== sessionID
  )
  await mkdir(dirname(commentsPath), { recursive: true })
  await Bun.write(commentsPath, `${JSON.stringify([...remaining, ...comments], null, 2)}\n`)
}
