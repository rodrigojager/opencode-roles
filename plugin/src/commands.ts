// Parsing of `/role [...]` arguments.
import { isRoleId } from "./request.ts"

export type RoleCommand =
  | { readonly kind: "pick" }
  | { readonly kind: "clear" }
  | { readonly kind: "show" }
  | { readonly kind: "set"; readonly id: string }
  | { readonly kind: "error"; readonly message: string }

export function parseRoleCommand(input: string | undefined): RoleCommand {
  const words = (input ?? "").trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { kind: "pick" }
  if (words.length > 1) return { kind: "error", message: "Usage: /role [<id>|none|default|show]" }
  const word = words[0] ?? ""
  const lower = word.toLowerCase()
  if (lower === "none" || lower === "default") return { kind: "clear" }
  if (lower === "show") return { kind: "show" }
  if (isRoleId(lower)) return { kind: "set", id: lower }
  return { kind: "error", message: `Invalid role ID: ${word}. Role IDs are lowercase file names, e.g. "historian".` }
}
