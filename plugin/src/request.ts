// Port of pi-subagent src/roles/request.ts (v0.13.0-rodrigo.9). Same rules, same messages.

export type RoleRequest =
  | { readonly kind: "default" }
  | { readonly kind: "none" }
  | { readonly kind: "named"; readonly id: string }

export function isRoleId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value) &&
    value !== "default" &&
    value !== "none" &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/.test(value)
  )
}

export function declaredRole(value: unknown): string | undefined {
  return isRoleId(value) ? value : undefined
}

export function normalizeRoleRequest(value: unknown = "default"): RoleRequest {
  if (value === "default") return Object.freeze({ kind: "default" })
  if (value === "none") return Object.freeze({ kind: "none" })
  if (isRoleId(value)) return Object.freeze({ kind: "named", id: value })
  throw new Error("Invalid role: use default, none, or a lowercase role ID.")
}

/** Parse only the prefix of a task. The task remainder stays intact. */
export function parseRolePrefix(input: string): {
  role?: string
  task: string
} {
  let rest = input.trimStart()
  let role: string | undefined
  while (rest) {
    const token = /^(\S+)(?:\s+|$)/.exec(rest)
    if (!token) break
    const word = token[1] ?? ""
    if (word === "--") {
      rest = rest.slice(token[0].length)
      break
    }
    if (word !== "--role" && !word.startsWith("--role=")) break
    if (role !== undefined) throw new Error("Duplicate --role option.")
    rest = rest.slice(token[0].length)
    if (word === "--role") {
      const value = /^(\S+)(?:\s+|$)/.exec(rest)
      if (!value || value[1]?.startsWith("--")) throw new Error("--role requires a value.")
      role = value[1] ?? ""
      rest = rest.slice(value[0].length)
    } else role = word.slice("--role=".length)
    normalizeRoleRequest(role)
  }
  return { ...(role !== undefined ? { role } : {}), task: rest }
}

/** True when a prompt starts with a --role option (after optional leading whitespace). */
export function hasRolePrefix(input: string): boolean {
  return /^\s*--role(?:=|\s|$)/.test(input)
}
