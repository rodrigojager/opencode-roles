import type { RoleResolution } from "./types.ts"

// Wording copied verbatim from pi-subagent src/roles/prompt.ts (v0.13.0-rodrigo.9). Do not edit.
export function rolePrompt(role?: RoleResolution): string {
  if (role?.status !== "resolved" || !role.body) return ""
  return `Current professional role: ${role.displayName} (${role.effectiveId})\n\nApply this professional perspective within the requested task. Respect the agent's execution constraints, project instructions, and applicable skills. Role examples and broad goals do not expand the task scope or grant tools, memory, credentials, or capabilities. Current task requirements take precedence over generic role preferences.\n\n${role.body}`
}

export function composeRolePrompt(agentPrompt: string, role?: RoleResolution): string {
  return [rolePrompt(role), agentPrompt].filter((s) => s.trim()).join("\n\n")
}

/** Marker that starts every injected role prompt; used to drop stale copies from a system array. */
export const ROLE_PROMPT_PREFIX = "Current professional role: "
