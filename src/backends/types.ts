export enum SessionBackend {
  OpenCode = "opencode",
  Pi = "pi",
}

export type BackendSession = {
  backend: SessionBackend
  id: string
  title?: string
  reference: string
}

export type SessionBackendAdapter = {
  backend: SessionBackend
  list(directory: string): Promise<BackendSession[]>
  prompt(session: BackendSession, directory: string, prompt: string): Promise<string>
}
