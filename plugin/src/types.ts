import type { RoleRequest } from "./request.ts"

/** Where a role file was found, highest precedence first. */
export type RoleSource = "project" | "shared" | "pi"

export interface RoleDocument {
  id: string
  name: string
  description: string
  category: string
  source: RoleSource
  sourcePath: string
  sourceRevision?: string | undefined
  sourceUrl?: string | undefined
  body: string
}

export interface RoleRoot {
  readonly source: RoleSource
  readonly directory: string
}

export interface RoleCatalog {
  roles: RoleDocument[]
  diagnostics: string[]
  rejected: Map<string, "invalid" | "unreadable">
  roots: RoleRoot[]
}

export type RoleStatus = "resolved" | "none" | "missing" | "invalid" | "unreadable"

export interface RoleResolution {
  readonly requested: RoleRequest
  readonly origin: "agent-default" | "invocation" | "base-conversation"
  readonly status: RoleStatus
  readonly requestedId?: string | undefined
  readonly effectiveId?: string | undefined
  readonly displayName?: string | undefined
  readonly source?: RoleSource | undefined
  readonly sourcePath?: string | undefined
  readonly sourceRevision?: string | undefined
  readonly body?: string | undefined
}
