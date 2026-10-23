import { afterAll, describe, expect, test } from "bun:test"
import { discoverRoles } from "../plugin/src/discovery.ts"
import { rolePrompt } from "../plugin/src/prompt.ts"
import { resolveRole } from "../plugin/src/resolver.ts"
import { withStoredRole } from "../plugin/src/session-role.ts"
import { createServerPlugin, PLUGIN_ID, SUBAGENT_ROLE_HINT } from "../plugin/server.ts"
import { cleanup, sampleCatalog } from "./fixtures.ts"

afterAll(cleanup)

type Hook = (event: any) => Promise<void> | void

async function host() {
  const { roots, catalog } = await sampleCatalog()
  const sessions = new Map<string, { metadata?: Record<string, unknown>; location: { directory: string } }>()
  const hooks = new Map<string, Hook>()
  const tools: any[] = []
  const ctx = {
    location: { directory: "D:/project" },
    tool: {
      transform: async (callback: (editor: any) => void) => {
        callback({ add: (tool: any) => tools.push(tool) })
        return { dispose: async () => {} }
      },
      hook: async (name: string, callback: Hook) => {
        hooks.set(`tool.${name}`, callback)
        return { dispose: async () => {} }
      },
    },
    session: {
      get: async ({ sessionID }: { sessionID: string }) => {
        const session = sessions.get(sessionID)
        if (!session) throw new Error(`no session ${sessionID}`)
        return session
      },
      hook: async (name: string, callback: Hook) => {
        hooks.set(`session.${name}`, callback)
        return { dispose: async () => {} }
      },
    },
  }
  const plugin = createServerPlugin({ discover: (options) => discoverRoles({ ...options, roots }), cacheMs: 0 })
  await plugin.setup(ctx as never)
  const setRole = (sessionID: string, id: string | undefined) => {
    const session = sessions.get(sessionID) ?? { location: { directory: "D:/project" } }
    session.metadata = withStoredRole(session.metadata, id ? { id, name: id } : undefined)
    sessions.set(sessionID, session)
  }
  const context = async (sessionID: string, system: any[] = [{ type: "text", text: "Base agent prompt" }]) => {
    const event = {
      sessionID,
      agent: "build",
      system,
      messages: [],
      options: {},
      tools: { subagent: { description: "Spawns an agent.", input: {} }, read: { description: "Read", input: {} } },
    }
    await hooks.get("session.context")!(event)
    return event
  }
  const before = async (tool: string, input: unknown, sessionID = "s1") => {
    const event = { tool, sessionID, agent: "build", messageID: "m", id: "c", input }
    await hooks.get("tool.execute.before")!(event)
    return event.input
  }
  return { catalog, tools, hooks, sessions, setRole, context, before }
}

describe("server plugin", () => {
  test("registers plugin id, the roles tool and the hooks", async () => {
    const h = await host()
    expect(PLUGIN_ID).toBe("opencode-roles")
    expect(h.tools.map((t) => t.name)).toEqual(["roles"])
    expect(h.tools[0].options).toEqual({ codemode: false })
    expect([...h.hooks.keys()].sort()).toEqual(["session.context", "tool.execute.before"])
  })

  test("no role: system prompt untouched, subagent tool learns about --role", async () => {
    const h = await host()
    h.setRole("s1", undefined)
    const event = await h.context("s1")
    expect(event.system).toEqual([{ type: "text", text: "Base agent prompt" }])
    expect(event.tools.subagent.description).toBe(`Spawns an agent.\n\n${SUBAGENT_ROLE_HINT}`)
    expect(event.tools.read.description).toBe("Read")
  })

  test("active role is appended to the system prompt with the exact Pi text", async () => {
    const h = await host()
    h.setRole("s1", "historian")
    const event = await h.context("s1")
    expect(event.system).toHaveLength(2)
    expect(event.system[1]).toEqual({
      type: "text",
      text: rolePrompt(resolveRole(h.catalog, undefined, "historian", "base-conversation")),
      metadata: { source: PLUGIN_ID, role: "historian" },
    })
  })

  test("changing or clearing the role drops the previous role text", async () => {
    const h = await host()
    h.setRole("s1", "historian")
    const first = await h.context("s1")
    h.setRole("s1", "anthropologist")
    // Even if a stale copy were present in the array, only the current role remains.
    const second = await h.context("s1", [...first.system])
    expect(second.system.map((part: any) => part.text.split("\n")[0])).toEqual([
      "Base agent prompt",
      "Current professional role: Anthropologist (anthropologist)",
    ])
    h.setRole("s1", undefined)
    const third = await h.context("s1", [...second.system])
    expect(third.system).toEqual([{ type: "text", text: "Base agent prompt" }])
  })

  test("roles are per session; a new session starts on default", async () => {
    const h = await host()
    h.setRole("s1", "historian")
    h.setRole("s2", undefined)
    expect((await h.context("s2")).system).toHaveLength(1)
    expect((await h.context("s1")).system).toHaveLength(2)
  })

  test("a deleted role or a failing lookup never breaks the request", async () => {
    const h = await host()
    h.setRole("s1", "gone-role")
    expect((await h.context("s1")).system).toHaveLength(1)
    expect((await h.context("unknown-session")).system).toHaveLength(1)
  })

  test("subagent --role <id>: role prepended, flag stripped, other input kept", async () => {
    const h = await host()
    h.setRole("s1", undefined)
    const input = await h.before("subagent", { agent: "explore", description: "d", prompt: "--role historian Summarise", background: true })
    const role = resolveRole(h.catalog, undefined, "historian", "invocation")
    expect(input).toEqual({ agent: "explore", description: "d", prompt: `${rolePrompt(role)}\n\nSummarise`, background: true })
    expect(await h.before("subagent", { agent: "x", description: "d", prompt: "--role=none Do it" })).toMatchObject({ prompt: "Do it" })
    expect(await h.before("task", { prompt: "--role historian X" })).toMatchObject({ prompt: `${rolePrompt(role)}\n\nX` })
  })

  test("subagent without the flag, or other tools, are untouched", async () => {
    const h = await host()
    h.setRole("s1", undefined)
    const plain = { agent: "x", description: "d", prompt: "No flag --role historian" }
    expect(await h.before("subagent", plain)).toBe(plain)
    const read = { path: "--role historian" }
    expect(await h.before("read", read)).toBe(read)
  })

  test("unknown role id fails the delegation with suggestions", async () => {
    const h = await host()
    h.setRole("s1", undefined)
    await expect(h.before("subagent", { agent: "x", description: "d", prompt: "--role historain go" })).rejects.toThrow(
      /Unknown role: historain\. Did you mean: historian/,
    )
  })

  test("roles tool returns JSON text", async () => {
    const h = await host()
    h.setRole("s1", undefined)
    const result = await h.tools[0].execute({ action: "list", query: "academic" }, { sessionID: "s1" })
    expect(JSON.parse(result.content)).toMatchObject({ total: 2, roles: [{ id: "anthropologist" }, { id: "historian" }] })
    const show = await h.tools[0].execute({ action: "show", id: "historian" }, { sessionID: "s1" })
    expect(JSON.parse(show.content).instructions).toBe("# Historian\n\nYou are Historian.")
  })
})
