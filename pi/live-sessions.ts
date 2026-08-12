import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Server, type Socket } from "node:net"
import { homedir } from "node:os"
import { join } from "node:path"
import type { ExtensionAPI, ExtensionContext } from "./types"

const LIVE_DIRECTORY = join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "opendiff", "pi")
const RECORD_SEPARATOR = "\n"

const REQUEST = {
  prompt: "prompt",
} as const

const RESPONSE = {
  result: "result",
  error: "error",
} as const

const ENTRY = {
  message: "message",
} as const

const ROLE = {
  assistant: "assistant",
} as const

const CONTENT = {
  text: "text",
} as const

const EVENT = {
  sessionStart: "session_start",
  sessionInfoChanged: "session_info_changed",
  agentSettled: "agent_settled",
  sessionShutdown: "session_shutdown",
} as const

type PendingRequest = {
  socket: Socket
  requestID: string
}

function assistantText(ctx: ExtensionContext) {
  const entry = ctx.sessionManager.getBranch().findLast((candidate) =>
    candidate.type === ENTRY.message && candidate.message.role === ROLE.assistant
  )
  if (entry?.type !== ENTRY.message || entry.message.role !== ROLE.assistant) return ""
  return entry.message.content
    .filter((part) => part.type === CONTENT.text)
    .map((part) => part.text)
    .join("")
}

export default function (pi: ExtensionAPI) {
  let server: Server | undefined
  let socketPath: string | undefined
  let metadataPath: string | undefined
  let pending: PendingRequest | undefined
  let sessionID: string | undefined
  let sessionCwd: string | undefined

  const writeMetadata = (title?: string) => {
    if (!metadataPath || !socketPath || !sessionID || !sessionCwd) return
    writeFileSync(metadataPath, `${JSON.stringify({
      id: sessionID,
      cwd: sessionCwd,
      title,
      socketPath,
    })}${RECORD_SEPARATOR}`, { mode: 0o600 })
  }

  const close = () => {
    if (pending) {
      pending.socket.end(`${JSON.stringify({ id: pending.requestID, type: RESPONSE.error, error: "Pi session closed" })}${RECORD_SEPARATOR}`)
      pending = undefined
    }
    server?.close()
    server = undefined
    if (socketPath) rmSync(socketPath, { force: true })
    if (metadataPath) rmSync(metadataPath, { force: true })
    sessionID = undefined
    sessionCwd = undefined
  }

  pi.on(EVENT.sessionStart, (_event, ctx) => {
    if (ctx.mode !== "tui") return
    close()
    mkdirSync(LIVE_DIRECTORY, { recursive: true, mode: 0o700 })
    sessionID = ctx.sessionManager.getSessionId()
    sessionCwd = ctx.cwd
    socketPath = join(LIVE_DIRECTORY, `${sessionID}.sock`)
    metadataPath = join(LIVE_DIRECTORY, `${sessionID}.json`)
    rmSync(socketPath, { force: true })

    server = createServer((socket) => {
      let buffer = ""
      socket.on("data", (chunk) => {
        buffer += chunk.toString()
        const records = buffer.split(RECORD_SEPARATOR)
        buffer = records.pop() ?? ""
        for (const record of records) {
          if (!record) continue
          const request = JSON.parse(record) as { id: string; type: string; prompt?: string }
          if (request.type !== REQUEST.prompt || !request.prompt) {
            socket.end(`${JSON.stringify({ id: request.id, type: RESPONSE.error, error: "Invalid request" })}${RECORD_SEPARATOR}`)
            continue
          }
          if (pending) {
            socket.end(`${JSON.stringify({ id: request.id, type: RESPONSE.error, error: "Pi session is busy" })}${RECORD_SEPARATOR}`)
            continue
          }
          pending = { socket, requestID: request.id }
          pi.sendUserMessage(request.prompt, ctx.isIdle() ? undefined : { deliverAs: "followUp" })
        }
      })
    })
    server.listen(socketPath, () => {
      chmodSync(socketPath!, 0o600)
      writeMetadata(pi.getSessionName())
    })
  })

  pi.on(EVENT.sessionInfoChanged, (event) => {
    writeMetadata(event.name)
  })

  pi.on(EVENT.agentSettled, (_event, ctx) => {
    if (!pending) return
    pending.socket.end(`${JSON.stringify({
      id: pending.requestID,
      type: RESPONSE.result,
      text: assistantText(ctx),
    })}${RECORD_SEPARATOR}`)
    pending = undefined
  })

  pi.on(EVENT.sessionShutdown, close)
}
