import { readdir, readFile } from "node:fs/promises"
import { createConnection } from "node:net"
import { homedir } from "node:os"
import { join } from "node:path"
import { SessionAvailability, SessionBackend, type BackendSession, type SessionBackendAdapter } from "./types"

const PI_COMMAND = "pi"
const SESSION_FILE_EXTENSION = ".jsonl"
const LIVE_SESSION_EXTENSION = ".json"
const SESSION_TITLE_LENGTH = 80
const RECORD_SEPARATOR = "\n"
const LIVE_DIRECTORY = join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "opendiff", "pi")

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

const LIVE = {
  prompt: "prompt",
  result: "result",
  error: "error",
} as const

type LiveSession = {
  id: string
  cwd: string
  title?: string
  socketPath: string
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
  return content?.filter((part) => part.type === CONTENT_TYPE.text).map((part) => part.text ?? "").join("") ?? ""
}

async function listStoredSessions(directory: string) {
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
        availability: SessionAvailability.Stored,
      }
    }))
  return sessions.filter((session): session is BackendSession => session !== undefined)
}

async function listLiveSessions(directory: string) {
  const files = await readdir(LIVE_DIRECTORY, { withFileTypes: true }).catch(() => [])
  const sessions: Array<BackendSession | undefined> = await Promise.all(files
    .filter((file) => file.isFile() && file.name.endsWith(LIVE_SESSION_EXTENSION))
    .map(async (file) => {
      const metadata = JSON.parse(await readFile(join(LIVE_DIRECTORY, file.name), "utf8")) as LiveSession
      if (metadata.cwd !== directory) return
      const live = await new Promise<boolean>((resolve) => {
        const socket = createConnection(metadata.socketPath)
        socket.once("connect", () => {
          socket.end()
          resolve(true)
        })
        socket.once("error", () => resolve(false))
      })
      if (!live) return
      return {
        backend: SessionBackend.Pi,
        id: metadata.id,
        title: metadata.title,
        reference: metadata.socketPath,
        availability: SessionAvailability.Live,
      }
    }))
  return sessions.filter((session): session is BackendSession => session !== undefined)
}

async function list(directory: string) {
  const [live, stored] = await Promise.all([listLiveSessions(directory), listStoredSessions(directory)])
  const liveIDs = new Set(live.map((session) => session.id))
  return [...live, ...stored.filter((session) => !liveIDs.has(session.id))]
}

async function promptLiveSession(session: BackendSession, prompt: string) {
  const requestID = crypto.randomUUID()
  return new Promise<string>((resolve, reject) => {
    const socket = createConnection(session.reference)
    let buffer = ""
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ id: requestID, type: LIVE.prompt, prompt })}${RECORD_SEPARATOR}`)
    })
    socket.on("data", (chunk) => {
      buffer += chunk.toString()
      const records = buffer.split(RECORD_SEPARATOR)
      buffer = records.pop() ?? ""
      for (const record of records) {
        if (!record) continue
        const response = JSON.parse(record) as { id: string; type: string; text?: string; error?: string }
        if (response.id !== requestID) continue
        socket.end()
        if (response.type === LIVE.error) reject(new Error(response.error ?? "Pi rejected the prompt"))
        else if (response.type === LIVE.result) resolve(response.text ?? "")
      }
    })
    socket.once("error", reject)
  })
}

async function promptStoredSession(session: BackendSession, directory: string, prompt: string) {
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

function prompt(session: BackendSession, directory: string, prompt: string) {
  return session.availability === SessionAvailability.Live
    ? promptLiveSession(session, prompt)
    : promptStoredSession(session, directory, prompt)
}

export const piBackend: SessionBackendAdapter = {
  backend: SessionBackend.Pi,
  list,
  prompt,
}
