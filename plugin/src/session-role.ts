// The per-session active role lives in the session's metadata, so the server (system prompt) and
// the TUI (picker, indicator) share it, it survives restarts, and a new session starts on default.
import { isRoleId } from "./request.ts"

export const METADATA_KEY = "opencode-roles"

export interface StoredRole {
  readonly id: string
  readonly name: string
}

type Metadata = Readonly<Record<string, unknown>> | undefined | null

export function readStoredRole(metadata: Metadata): StoredRole | undefined {
  const value = metadata?.[METADATA_KEY]
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const { id, name } = value as Record<string, unknown>
  if (!isRoleId(id)) return undefined
  return { id, name: typeof name === "string" && name.trim() ? name : id }
}

/** New metadata object with the role set (or removed when `role` is undefined); other keys are kept. */
export function withStoredRole(metadata: Metadata, role: StoredRole | undefined): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(metadata ?? {}) }
  if (role) next[METADATA_KEY] = { id: role.id, name: role.name }
  else delete next[METADATA_KEY]
  return next
}
