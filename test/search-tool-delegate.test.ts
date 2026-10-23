import { afterAll, describe, expect, test } from "bun:test"
import { applyRoleFlag, RoleFlagError } from "../plugin/src/delegate.ts"
import { composeRolePrompt, rolePrompt } from "../plugin/src/prompt.ts"
import { resolveRole } from "../plugin/src/resolver.ts"
import { filterRoles, levenshtein, normalizeText, suggestRoles } from "../plugin/src/search.ts"
import { readStoredRole, withStoredRole } from "../plugin/src/session-role.ts"
import { runRolesTool } from "../plugin/src/tool.ts"
import { cleanup, sampleCatalog } from "./fixtures.ts"

afterAll(cleanup)

const PREAMBLE =
  "Apply this professional perspective within the requested task. Respect the agent's execution constraints, project instructions, and applicable skills. Role examples and broad goals do not expand the task scope or grant tools, memory, credentials, or capabilities. Current task requirements take precedence over generic role preferences."

describe("prompt text (exact pi-subagent wording)", () => {
  test("rolePrompt", async () => {
    const { catalog } = await sampleCatalog()
    const role = resolveRole(catalog, undefined, "historian", "base-conversation")
    expect(rolePrompt(role)).toBe(`Current professional role: Historian (historian)\n\n${PREAMBLE}\n\n# Historian\n\nYou are Historian.`)
    expect(composeRolePrompt("Do the task", role)).toBe(`${rolePrompt(role)}\n\nDo the task`)
    expect(rolePrompt(resolveRole(catalog, undefined, "none"))).toBe("")
    expect(rolePrompt(resolveRole(catalog, undefined, "missing-role"))).toBe("")
  })
})

describe("search", () => {
  test("every word must match name, id, category or description; accents ignored", async () => {
    const { catalog } = await sampleCatalog()
    const ids = (query: string) => filterRoles(catalog.roles, query).map((r) => r.id)
    expect(ids("")).toHaveLength(6)
    expect(ids("backend api")).toEqual(["backend-architect"])
    expect(ids("ACADEMIC")).toEqual(["anthropologist", "historian"])
    expect(ids("analise usuario")).toEqual(["ux-researcher"]) // "análise", "usuário"
    expect(ids("anális")).toEqual(["ux-researcher"])
    expect(ids("root-cause")).toEqual(["root-cause-debugger"])
    expect(ids("historian backend")).toEqual([])
    expect(normalizeText("Ãção")).toBe("acao")
  })
  test("close-match suggestions", async () => {
    const { catalog } = await sampleCatalog()
    expect(levenshtein("kitten", "sitting")).toBe(3)
    expect(suggestRoles("historain", catalog.roles)[0]).toBe("historian")
    expect(suggestRoles("backend", catalog.roles)).toContain("backend-architect")
    expect(suggestRoles("frontend-dev", catalog.roles)).toContain("frontend-developer")
    expect(suggestRoles("zzzzzz", catalog.roles)).toEqual([])
  })
})

describe("--role on delegated prompts", () => {
  test("applies the role and strips the flag", async () => {
    const { catalog } = await sampleCatalog()
    const result = applyRoleFlag("--role historian Summarise the treaty", catalog)
    expect(result.kind).toBe("applied")
    if (result.kind !== "applied") return
    expect(result.prompt).toBe(
      `Current professional role: Historian (historian)\n\n${PREAMBLE}\n\n# Historian\n\nYou are Historian.\n\nSummarise the treaty`,
    )
    const eq = applyRoleFlag("--role=historian\nMulti\nline", catalog)
    expect(eq.kind === "applied" && eq.prompt.endsWith("You are Historian.\n\nMulti\nline")).toBe(true)
  })
  test("--role none / default strip the flag without a role", async () => {
    const { catalog } = await sampleCatalog()
    expect(applyRoleFlag("--role none just do it", catalog)).toMatchObject({ kind: "applied", prompt: "just do it" })
    expect(applyRoleFlag("--role=default just do it", catalog)).toMatchObject({ kind: "applied", prompt: "just do it" })
  })
  test("prompts without the flag are untouched", async () => {
    const { catalog } = await sampleCatalog()
    expect(applyRoleFlag("Review this --role historian", catalog)).toEqual({ kind: "unchanged" })
  })
  test("unknown id fails with close-match suggestions", async () => {
    const { catalog } = await sampleCatalog()
    expect(() => applyRoleFlag("--role historain do it", catalog)).toThrow(RoleFlagError)
    expect(() => applyRoleFlag("--role historain do it", catalog)).toThrow(
      /Unknown role: historain\. Did you mean: historian.*roles tool/,
    )
    expect(() => applyRoleFlag("--role Bad do it", catalog)).toThrow(/Invalid role/)
    expect(() => applyRoleFlag("--role", catalog)).toThrow("--role requires a value.")
  })
})

describe("roles tool", () => {
  test("list with query, offset and limit", async () => {
    const { catalog } = await sampleCatalog()
    const all = runRolesTool(catalog, { action: "list", limit: 4 }) as { roles: { id: string }[]; total: number; nextOffset?: number }
    expect(all.total).toBe(6)
    expect(all.roles.map((r) => r.id)).toEqual(["anthropologist", "backend-architect", "frontend-developer", "historian"])
    expect(all.nextOffset).toBe(4)
    const page2 = runRolesTool(catalog, { action: "list", offset: 4, limit: 4 }) as { roles: { id: string }[]; nextOffset?: number }
    expect(page2.roles.map((r) => r.id)).toEqual(["root-cause-debugger", "ux-researcher"])
    expect(page2.nextOffset).toBeUndefined()
    const q = runRolesTool(catalog, { action: "list", query: "academic" }) as { roles: unknown[]; total: number }
    expect(q.total).toBe(2)
    expect(q.roles[0]).toEqual({
      id: "anthropologist",
      name: "Anthropologist",
      description: "Expert in cultural systems, rituals, kinship",
      category: "academic",
      scope: "pi",
    })
    expect((runRolesTool(catalog, { action: "list", limit: 500 }) as { roles: unknown[] }).roles).toHaveLength(6)
  })
  test("show returns the instructions or a not-found status", async () => {
    const { catalog } = await sampleCatalog()
    expect(runRolesTool(catalog, { action: "show", id: "historian" })).toMatchObject({
      id: "historian",
      name: "Historian",
      scope: "pi",
      revision: "rev1",
      instructions: "# Historian\n\nYou are Historian.",
    })
    expect(runRolesTool(catalog, { action: "show", id: "nope" })).toEqual({ error: "Role not found: nope", status: "missing" })
    expect(runRolesTool(catalog, { action: "show" })).toEqual({ error: "Role not found: (missing ID)", status: "invalid" })
    expect(runRolesTool(catalog, { action: "delete" })).toHaveProperty("error")
  })
})

describe("session metadata", () => {
  test("read and write keep other keys", () => {
    const metadata = { other: 1 }
    const next = withStoredRole(metadata, { id: "historian", name: "Historian" })
    expect(next).toEqual({ other: 1, "opencode-roles": { id: "historian", name: "Historian" } })
    expect(readStoredRole(next)).toEqual({ id: "historian", name: "Historian" })
    expect(withStoredRole(next, undefined)).toEqual({ other: 1 })
    expect(readStoredRole(undefined)).toBeUndefined()
    expect(readStoredRole({ "opencode-roles": { id: "Bad Id" } })).toBeUndefined()
    expect(metadata).toEqual({ other: 1 })
  })
})
