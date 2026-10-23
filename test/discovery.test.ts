import { afterAll, describe, expect, test } from "bun:test"
import path from "node:path"
import { createCatalogCache, discoverRoles, nearestProjectRolesRoot, roleRoots } from "../plugin/src/discovery.ts"
import { cleanup, role, sampleCatalog, tree } from "./fixtures.ts"

afterAll(cleanup)

describe("discovery", () => {
  test("ids from filenames, metadata from frontmatter, sorted by id", async () => {
    const { catalog } = await sampleCatalog()
    expect(catalog.roles.map((r) => r.id)).toEqual([
      "anthropologist",
      "backend-architect",
      "frontend-developer",
      "historian",
      "root-cause-debugger",
      "ux-researcher",
    ])
    const historian = catalog.roles.find((r) => r.id === "historian")!
    expect(historian).toMatchObject({
      name: "Historian",
      category: "academic",
      description: "Historical analysis and periodization",
      source: "pi",
      sourceRevision: "rev1",
      body: "# Historian\n\nYou are Historian.",
    })
    expect(catalog.diagnostics).toEqual([])
  })

  test("precedence: project > ~/.agents/roles > ~/.pi/agent/roles", async () => {
    const pi = await tree({ "a/historian.md": role("Pi Historian", "pi", "a"), "a/only-pi.md": role("Only Pi", "pi", "a") })
    const shared = await tree({ "historian.md": role("Shared Historian", "shared", "b"), "only-shared.md": role("Only Shared", "s", "b") })
    const project = await tree({ "historian.md": role("Project Historian", "project", "c") })
    const catalog = await discoverRoles({
      roots: [
        { source: "project", directory: project },
        { source: "shared", directory: shared },
        { source: "pi", directory: pi },
      ],
    })
    const byId = Object.fromEntries(catalog.roles.map((r) => [r.id, `${r.source}:${r.name}`]))
    expect(byId).toEqual({
      historian: "project:Project Historian",
      "only-pi": "pi:Only Pi",
      "only-shared": "shared:Only Shared",
    })
  })

  test("default roots come from home and the nearest .opencode/roles", async () => {
    const home = await tree({ ".pi/agent/roles/x/one.md": role("One", "d", "x"), ".agents/roles/two.md": role("Two", "d", "y") })
    const project = await tree({ ".opencode/roles/three.md": role("Three", "d", "z"), "packages/app/src/.keep": "" })
    const roots = await roleRoots({ directory: path.join(project, "packages", "app", "src"), home })
    expect(roots.map((r) => r.source)).toEqual(["project", "shared", "pi"])
    expect(await nearestProjectRolesRoot(path.join(project, "packages"))).toBe(path.join(project, ".opencode", "roles"))
    const catalog = await discoverRoles({ directory: path.join(project, "packages"), home })
    expect(catalog.roles.map((r) => `${r.id}:${r.source}`)).toEqual(["one:pi", "three:project", "two:shared"])
  })

  test("invalid files are rejected with diagnostics; a broken higher root shadows a lower one", async () => {
    const low = await tree({ "dup.md": role("Low Dup", "d", "c"), "empty.md": role("Fine", "d", "c") })
    const high = await tree({
      "Upper.md": role("Upper", "d", "c"),
      "default.md": role("Reserved", "d", "c"),
      "empty.md": "---\nname: Empty\n---\n\n   \n",
      "a/dup.md": role("Dup A", "d", "c"),
      "b/dup.md": role("Dup B", "d", "c"),
      "bad-yaml.md": "---\nname: [unclosed\nnope\n---\nBody\n",
      "mismatch.md": "---\nid: other\n---\nBody\n",
      "unterminated.md": "---\nname: X\nBody without end\n",
      "notes.txt": "ignored",
      "plain.md": "No frontmatter at all, still a role.",
    })
    const catalog = await discoverRoles({
      roots: [
        { source: "project", directory: high },
        { source: "pi", directory: low },
      ],
    })
    expect(catalog.roles.map((r) => r.id)).toEqual(["plain"])
    expect(catalog.roles[0]?.name).toBe("Plain")
    expect(Object.fromEntries(catalog.rejected)).toEqual({
      "bad-yaml": "invalid",
      dup: "invalid",
      empty: "invalid",
      mismatch: "invalid",
      unterminated: "invalid",
    })
    const text = catalog.diagnostics.join("\n")
    expect(text).toContain("Upper.md: invalid filename ID")
    expect(text).toContain("default.md: invalid filename ID")
    expect(text).toContain("ambiguous role ID dup")
    expect(text).toContain("Empty role body")
    expect(text).toContain("Metadata ID disagrees with filename")
  })

  test("category falls back to the first folder; name falls back to the title-cased id", async () => {
    const dir = await tree({ "engineering/sub/minimal-change.md": "---\ndescription: d\n---\nBody" })
    const catalog = await discoverRoles({ roots: [{ source: "pi", directory: dir }] })
    expect(catalog.roles[0]).toMatchObject({ id: "minimal-change", name: "Minimal Change", category: "engineering" })
  })

  test("missing roots are simply empty", async () => {
    const catalog = await discoverRoles({ roots: [{ source: "pi", directory: path.join(import.meta.dir, "no-such-dir") }] })
    expect(catalog).toMatchObject({ roles: [], diagnostics: [] })
  })

  test("catalog cache reuses a scan within the TTL", async () => {
    let scans = 0
    const cache = createCatalogCache(60_000, async () => {
      scans++
      return { roles: [], diagnostics: [], rejected: new Map(), roots: [] }
    })
    await cache.get({ directory: "x" })
    await cache.get({ directory: "x" })
    await cache.get({ directory: "y" })
    expect(scans).toBe(2)
    cache.clear()
    await cache.get({ directory: "x" })
    expect(scans).toBe(3)
  })
})
