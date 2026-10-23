// OpenCode v2 server plugin: injects the session's active role into the main agent's system prompt,
// applies `--role <id>` to delegated subagent prompts, and registers the read-only `roles` tool.
import type { Plugin } from "@opencode/plugin"
import { applyRoleFlag, SUBAGENT_TOOLS } from "./src/delegate.ts"
import { createCatalogCache, discoverRoles } from "./src/discovery.ts"
import { ROLE_PROMPT_PREFIX, rolePrompt } from "./src/prompt.ts"
import { hasRolePrefix } from "./src/request.ts"
import { resolveRole } from "./src/resolver.ts"
import { readStoredRole } from "./src/session-role.ts"
import { ROLES_TOOL_DESCRIPTION, ROLES_TOOL_INPUT, ROLES_TOOL_NAME, type RolesToolParams, runRolesTool } from "./src/tool.ts"

export const PLUGIN_ID = "opencode-roles"

/** Appended to the subagent tool description so the model knows about the option. */
export const SUBAGENT_ROLE_HINT =
  'Professional role (optional): start `prompt` with `--role <id>` (or `--role=<id>`) to give the subagent that persona; the option is stripped and the role text is prepended. A role changes behaviour and personality only; it grants no tools. Look up IDs with the `roles` tool (action "list"); an unknown ID fails the call. `--role none` means no role.'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export interface ServerPluginOptions {
  /** Catalog loader (tests inject fixed roots). Defaults to a fresh filesystem scan. */
  readonly discover?: typeof discoverRoles
  readonly cacheMs?: number
}

export function createServerPlugin(options: ServerPluginOptions = {}): Plugin.Plugin {
  const discover = options.discover ?? discoverRoles
  return {
  id: PLUGIN_ID,
  async setup(ctx) {
    const catalogs = createCatalogCache(options.cacheMs ?? 5000, discover)
    const directoryOf = async (sessionID: string) => {
      try {
        return (await ctx.session.get({ sessionID })).location?.directory ?? ctx.location.directory
      } catch {
        return ctx.location.directory
      }
    }

    await ctx.tool.transform((editor) => {
      editor.add({
        name: ROLES_TOOL_NAME,
        description: ROLES_TOOL_DESCRIPTION,
        input: ROLES_TOOL_INPUT,
        options: { codemode: false },
        execute: async (input, context) => {
          // Fresh snapshot for the model, as in Pi.
          const catalog = await discover({ directory: await directoryOf(context.sessionID) })
          const data = runRolesTool(catalog, (isRecord(input) ? input : {}) as RolesToolParams)
          return { content: JSON.stringify(data, null, 2) }
        },
      })
    })

    await ctx.session.hook("context", async (event) => {
      try {
        // Never persisted: the system array is rebuilt for every model call, so a role change (or
        // clearing it) takes effect on the next request and the previous role's text is gone.
        for (let index = event.system.length - 1; index >= 0; index--) {
          const part = event.system[index]
          if (part?.metadata?.["source"] === PLUGIN_ID || part?.text.startsWith(ROLE_PROMPT_PREFIX)) event.system.splice(index, 1)
        }
        for (const name of SUBAGENT_TOOLS) {
          const tool = event.tools[name]
          if (tool && !tool.description.includes("--role <id>")) tool.description = `${tool.description}\n\n${SUBAGENT_ROLE_HINT}`
        }
        const session = await ctx.session.get({ sessionID: event.sessionID })
        const stored = readStoredRole(session.metadata)
        if (!stored) return
        const catalog = await catalogs.get({ directory: session.location?.directory ?? ctx.location.directory })
        const text = rolePrompt(resolveRole(catalog, undefined, stored.id, "base-conversation"))
        if (text) event.system.push({ type: "text", text, metadata: { source: PLUGIN_ID, role: stored.id } })
      } catch (error) {
        console.warn(`[${PLUGIN_ID}] role injection skipped: ${error instanceof Error ? error.message : String(error)}`)
      }
    })

    await ctx.tool.hook("execute.before", async (event) => {
      if (!SUBAGENT_TOOLS.has(event.tool)) return
      const input = event.input
      if (!isRecord(input) || typeof input["prompt"] !== "string" || !hasRolePrefix(input["prompt"])) return
      const catalog = await catalogs.get({ directory: await directoryOf(event.sessionID) })
      // Throws (failing only this call, with the message shown to the model) for an unknown role.
      const result = applyRoleFlag(input["prompt"], catalog)
      if (result.kind === "applied") event.input = { ...input, prompt: result.prompt }
    })
  },
  }
}

export default createServerPlugin()
