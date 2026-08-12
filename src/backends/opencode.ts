import { OpenCode } from "@opencode-ai/client"
import { SessionBackend, type SessionBackendAdapter } from "./types"

type Client = ReturnType<typeof OpenCode.make>

const MESSAGE_TYPE = {
  assistant: "assistant",
  text: "text",
} as const

const SESSION_ORDER = {
  descending: "desc",
} as const

export function createOpenCodeBackend(client: Client): SessionBackendAdapter {
  return {
    backend: SessionBackend.OpenCode,
    async list(directory) {
      const sessions = await client.session.list({ directory, order: SESSION_ORDER.descending })
      return sessions.data.map((session) => ({
        backend: SessionBackend.OpenCode,
        id: session.id,
        title: session.title,
        reference: session.id,
      }))
    },
    async prompt(session, _directory, prompt) {
      const pending = await client.session.prompt({ sessionID: session.reference, text: prompt })
      await client.session.wait({ sessionID: session.reference }).catch(() => undefined)
      const messages = await client.message.list({ sessionID: session.reference, order: SESSION_ORDER.descending, limit: 20 })
      const response = messages.data.find((message) =>
        message.type === MESSAGE_TYPE.assistant && message.time.created >= pending.timeCreated
      )
      return response?.type === MESSAGE_TYPE.assistant
        ? response.content.filter((part) => part.type === MESSAGE_TYPE.text).map((part) => part.text).join("")
        : ""
    },
  }
}
