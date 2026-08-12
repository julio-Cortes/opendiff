import { readdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

export type PiSessionInfo = {
  backend: "pi"
  id: string
  title?: string
  path: string
}

type SessionEntry = {
  type: string
  id?: string
  cwd?: string
  name?: string
  message?: {
    role?: string
    content?: string | Array<{ type?: string; text?: string }>
  }
}

const sessionsDirectory = join(homedir(), ".pi", "agent", "sessions")

function messageText(entry?: SessionEntry) {
  const content = entry?.message?.content
  if (typeof content === "string") return content
  return content?.filter((part) => part.type === "text").map((part) => part.text ?? "").join("") ?? ""
}

export async function listPiSessions(directory: string): Promise<PiSessionInfo[]> {
  const files = await readdir(sessionsDirectory, { recursive: true, withFileTypes: true }).catch(() => [])
  const sessions: Array<PiSessionInfo | undefined> = await Promise.all(files
    .filter((file) => file.isFile() && file.name.endsWith(".jsonl"))
    .map(async (file) => {
      const path = join(file.parentPath, file.name)
      const entries = (await readFile(path, "utf8"))
        .trim().split("\n").filter(Boolean)
        .map((line) => JSON.parse(line) as SessionEntry)
      const header = entries[0]
      if (header?.type !== "session" || header.cwd !== directory || !header.id) return
      const name = entries.findLast((entry) => entry.type === "session_info")?.name
      const firstMessage = entries.find((entry) => entry.type === "message" && entry.message?.role === "user")
      const title = name ?? (messageText(firstMessage).split("\n")[0].slice(0, 80) || undefined)
      return {
        backend: "pi" as const,
        id: header.id,
        title,
        path,
      }
    }))
  return sessions.filter((session): session is PiSessionInfo => session !== undefined)
}

export async function promptPiSession(path: string, directory: string, prompt: string) {
  const child = Bun.spawn(["pi", "--mode", "rpc", "--session", path], {
    cwd: directory,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  const requestID = crypto.randomUUID()
  let buffer = ""
  let settled = false
  let response = ""

  child.stdin.write(`${JSON.stringify({ id: requestID, type: "prompt", message: prompt })}\n`)
  child.stdin.flush()

  try {
    for await (const chunk of child.stdout) {
      buffer += new TextDecoder().decode(chunk)
      const records = buffer.split("\n")
      buffer = records.pop() ?? ""
      for (const record of records) {
        if (!record) continue
        const event = JSON.parse(record) as {
          type: string
          id?: string
          success?: boolean
          error?: string
          message?: {
            role?: string
            content?: Array<{ type?: string; text?: string }>
          }
        }
        if (event.type === "response" && event.id === requestID && event.success === false) {
          throw new Error(event.error ?? "Pi rejected the prompt")
        }
        if (event.type === "message_end" && event.message?.role === "assistant") {
          response = event.message.content?.filter((part) => part.type === "text").map((part) => part.text ?? "").join("") ?? ""
        }
        if (event.type === "agent_settled") {
          settled = true
          break
        }
      }
      if (settled) break
    }
  } finally {
    child.stdin.end()
    child.kill()
    await child.exited
  }

  if (!settled) {
    const error = await new Response(child.stderr).text()
    throw new Error(error.trim() || "Pi exited before completing the prompt")
  }
  return response
}
