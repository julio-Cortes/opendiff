type MessageContent = {
  type: string
  text?: string
}

type SessionEntry = {
  type: string
  message: {
    role: string
    content: MessageContent[]
  }
}

export type ExtensionContext = {
  mode: "tui" | "rpc" | "json" | "print"
  cwd: string
  isIdle(): boolean
  sessionManager: {
    getSessionId(): string
    getBranch(): SessionEntry[]
  }
}

type ExtensionEvent = {
  session_start: Record<string, never>
  session_info_changed: { name: string | undefined }
  agent_settled: Record<string, never>
  session_shutdown: Record<string, never>
}

export type ExtensionAPI = {
  on<Event extends keyof ExtensionEvent>(
    event: Event,
    handler: (event: ExtensionEvent[Event], context: ExtensionContext) => void,
  ): void
  getSessionName(): string | undefined
  sendUserMessage(content: string, options?: { deliverAs: "steer" | "followUp" }): void
}
