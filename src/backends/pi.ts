import { readdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { SessionBackend, type BackendSession, type SessionBackendAdapter } from "./types"

const PI_COMMAND = "pi"
const SESSION_FILE_EXTENSION = ".jsonl"
const SESSION_TITLE_LENGTH = 80
const RECORD_SEPARATOR = "\n"

const SESSION_ENTRY = {
  header: "session",
  info: "session_info",
  message: "message",
} as const

const MESSAGE_ROLE = {
  user: "user",
  assistant: "assistant",
} as const

const CONTENT_TYPE = {
  text: "text",
} as const

const RPC = {
  mode: "rpc",
  prompt: "prompt",
  response: "response",
  messageEnd: "message_end",
  agentSettled: "agent_settled",
} as const

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
  return content?.filter((part) => part.type === CONTENT_TYPE.text).map((part) => part.text ?? "").join("") ?? ""
}

async function list(directory: string) {
  const files = await readdir(sessionsDirectory, { recursive: true, withFileTypes: true }).catch(() => [])
  const sessions: Array<BackendSession | undefined> = await Promise.all(files
    .filter((file) => file.isFile() && file.name.endsWith(SESSION_FILE_EXTENSION))
    .map(async (file) => {
      const path = join(file.parentPath, file.name)
      const entries = (await readFile(path, "utf8"))
        .trim().split(RECORD_SEPARATOR).filter(Boolean)
        .map((line) => JSON.parse(line) as SessionEntry)
      const header = entries[0]
      if (header?.type !== SESSION_ENTRY.header || header.cwd !== directory || !header.id) return
      const name = entries.findLast((entry) => entry.type === SESSION_ENTRY.info)?.name
      const firstMessage = entries.find((entry) =>
        entry.type === SESSION_ENTRY.message && entry.message?.role === MESSAGE_ROLE.user
      )
      return {
        backend: SessionBackend.Pi,
        id: header.id,
        title: name ?? (messageText(firstMessage).split(RECORD_SEPARATOR)[0].slice(0, SESSION_TITLE_LENGTH) || undefined),
        reference: path,
      }
    }))
  return sessions.filter((session): session is BackendSession => session !== undefined)
}

async function prompt(session: BackendSession, directory: string, prompt: string) {
  const child = Bun.spawn([PI_COMMAND, "--mode", RPC.mode, "--session", session.reference], {
    cwd: directory,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  const requestID = crypto.randomUUID()
  let buffer = ""
  let settled = false
  let response = ""

  child.stdin.write(`${JSON.stringify({ id: requestID, type: RPC.prompt, message: prompt })}${RECORD_SEPARATOR}`)
  child.stdin.flush()

  try {
    for await (const chunk of child.stdout) {
      buffer += new TextDecoder().decode(chunk)
      const records = buffer.split(RECORD_SEPARATOR)
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
        if (event.type === RPC.response && event.id === requestID && event.success === false) {
          throw new Error(event.error ?? "Pi rejected the prompt")
        }
        if (event.type === RPC.messageEnd && event.message?.role === MESSAGE_ROLE.assistant) {
          response = event.message.content
            ?.filter((part) => part.type === CONTENT_TYPE.text)
            .map((part) => part.text ?? "")
            .join("") ?? ""
        }
        if (event.type === RPC.agentSettled) {
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

export const piBackend: SessionBackendAdapter = {
  backend: SessionBackend.Pi,
  list,
  prompt,
}
