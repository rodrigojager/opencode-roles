// Port of pi-subagent src/roles/resolver.ts (resolveRole).
import { declaredRole, normalizeRoleRequest } from "./request.ts"
import type { RoleCatalog, RoleResolution } from "./types.ts"

export function resolveRole(
  catalog: RoleCatalog,
  agentRole?: string,
  input?: unknown,
  origin?: RoleResolution["origin"],
): RoleResolution {
  const requested = normalizeRoleRequest(input)
  const selectedOrigin = origin ?? (requested.kind === "default" ? "agent-default" : "invocation")
  const base = { requested, origin: selectedOrigin }
  if (requested.kind === "none") return Object.freeze({ ...base, status: "none" as const })
  const id = requested.kind === "named" ? requested.id : declaredRole(agentRole)
  if (!id) return Object.freeze({ ...base, status: "none" as const })
  const role = catalog.roles.find((r) => r.id === id)
  if (!role)
    return Object.freeze({
      ...base,
      requestedId: id,
      status: catalog.rejected.get(id) ?? ("missing" as const),
    })
  return Object.freeze({
    ...base,
    requestedId: id,
    effectiveId: id,
    displayName: role.name,
    source: role.source,
    sourcePath: role.sourcePath,
    sourceRevision: role.sourceRevision,
    body: role.body,
    status: "resolved" as const,
  })
}
