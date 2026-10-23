// Read-only `roles` tool. Mirrors pi-subagent src/roles/tool.ts (list/show, same fields).
import { isRoleId } from "./request.ts"
import { filterRoles } from "./search.ts"
import type { RoleCatalog } from "./types.ts"

export const ROLES_TOOL_NAME = "roles"

export const ROLES_TOOL_DESCRIPTION =
  "Read the offline professional-role catalog. List IDs before choosing a subagent role override. Does not select, import, or launch anything."

export const ROLES_TOOL_INPUT = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["list", "show"], description: "list: search the catalog; show: one role's instructions" },
    query: { type: "string", description: "list: words that must all match the name, ID, category or description" },
    id: { type: "string", description: "show: the role ID" },
    offset: { type: "integer", minimum: 0, description: "list: index of the first result (default 0)" },
    limit: { type: "integer", minimum: 1, maximum: 50, description: "list: page size (default 25, max 50)" },
  },
  required: ["action"],
  additionalProperties: false,
} as const

export interface RolesToolParams {
  action?: unknown
  query?: unknown
  id?: unknown
  offset?: unknown
  limit?: unknown
}

const integer = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : undefined

export function runRolesTool(catalog: RoleCatalog, params: RolesToolParams): unknown {
  if (params.action === "show") {
    const id = typeof params.id === "string" ? params.id.trim() : undefined
    const role = isRoleId(id) ? catalog.roles.find((r) => r.id === id) : undefined
    return role
      ? {
          id: role.id,
          name: role.name,
          description: role.description,
          category: role.category,
          scope: role.source,
          source: role.sourceUrl,
          revision: role.sourceRevision,
          instructions: role.body,
        }
      : {
          error: `Role not found: ${id || "(missing ID)"}`,
          status: id ? (catalog.rejected.get(id) ?? "missing") : "invalid",
        }
  }
  if (params.action !== undefined && params.action !== "list")
    return { error: `Unknown action: ${String(params.action)}. Use "list" or "show".` }
  const matches = filterRoles(catalog.roles, typeof params.query === "string" ? params.query : "")
  const offset = Math.max(0, integer(params.offset) ?? 0)
  const limit = Math.min(50, Math.max(1, integer(params.limit) ?? 25))
  return {
    roles: matches.slice(offset, offset + limit).map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      category: r.category,
      scope: r.source,
    })),
    total: matches.length,
    ...(offset + limit < matches.length ? { nextOffset: offset + limit } : {}),
  }
}
