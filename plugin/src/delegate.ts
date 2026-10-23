// `--role <id>` handling for delegated subagent prompts (pi-subagent parseRolePrefix semantics).
import { composeRolePrompt } from "./prompt.ts"
import { hasRolePrefix, parseRolePrefix } from "./request.ts"
import { resolveRole } from "./resolver.ts"
import { suggestRoles } from "./search.ts"
import type { RoleCatalog, RoleResolution } from "./types.ts"

/** Tools whose `prompt` input starts a subagent: OpenCode v2 `subagent`, plus v1-style `task`. */
export const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(["subagent", "task"])

export type RoleFlagResult =
  | { readonly kind: "unchanged" }
  | { readonly kind: "applied"; readonly prompt: string; readonly role: RoleResolution }

export class RoleFlagError extends Error {}

export function unknownRoleMessage(id: string, catalog: RoleCatalog, status = "missing") {
  const suggestions = suggestRoles(id, catalog.roles)
  const reason = status === "invalid" || status === "unreadable" ? ` (${status} role file)` : ""
  return [
    `Unknown role: ${id}${reason}.`,
    suggestions.length ? `Did you mean: ${suggestions.join(", ")}?` : "No close matches.",
    'Use the roles tool (action "list", with a query) to find a role ID, or "--role none" for no role.',
  ].join(" ")
}

/**
 * Applies a leading `--role <id>` / `--role=<id>` / `--role none` to a delegated prompt.
 * Returns "unchanged" when the prompt has no role option. Throws RoleFlagError for an
 * invalid or unknown role, so the delegation fails before the subagent starts.
 */
export function applyRoleFlag(prompt: string, catalog: RoleCatalog | (() => RoleCatalog)): RoleFlagResult {
  if (!hasRolePrefix(prompt)) return { kind: "unchanged" }
  let parsed: ReturnType<typeof parseRolePrefix>
  try {
    parsed = parseRolePrefix(prompt)
  } catch (error) {
    throw new RoleFlagError(error instanceof Error ? error.message : String(error))
  }
  if (parsed.role === undefined) return { kind: "unchanged" }
  const resolvedCatalog = typeof catalog === "function" ? catalog() : catalog
  const role = resolveRole(resolvedCatalog, undefined, parsed.role, "invocation")
  if (role.status === "none") return { kind: "applied", prompt: parsed.task, role }
  if (role.status !== "resolved")
    throw new RoleFlagError(unknownRoleMessage(role.requestedId ?? parsed.role, resolvedCatalog, role.status))
  return { kind: "applied", prompt: composeRolePrompt(parsed.task, role), role }
}
