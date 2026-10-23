// Role discovery. Port of pi-subagent src/roles/discovery.ts (user/project scan path) with the
// OpenCode precedence: <project>/.opencode/roles > ~/.agents/roles > ~/.pi/agent/roles.
import type { Dirent } from "node:fs"
import { readdir, readFile, realpath, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parseFrontmatter, stripBom } from "./frontmatter.ts"
import { isRoleId } from "./request.ts"
import type { RoleCatalog, RoleDocument, RoleRoot, RoleSource } from "./types.ts"

type Entry = RoleDocument | "invalid" | "unreadable"

export function titleFromId(id: string) {
  return id
    .split(/[._-]/)
    .map((word) => (word[0]?.toUpperCase() ?? "") + word.slice(1))
    .join(" ")
}

export function parseRoleDocument(content: string, file: string, source: RoleSource, folderCategory = ""): RoleDocument {
  const id = path.basename(file, ".md")
  if (!isRoleId(id)) throw new Error("Invalid or reserved filename ID")
  const text = stripBom(content)
  if (/^---\s*\r?\n/.test(text) && !/^---\s*\r?\n[\s\S]*?\r?\n---(?:\s*\r?\n|\s*$)/.test(text))
    throw new Error("Unterminated frontmatter")
  const { frontmatter: f, body } = parseFrontmatter(text)
  if (!f || typeof f !== "object" || Array.isArray(f)) throw new Error("Invalid frontmatter object")
  if (f["id"] !== undefined && f["id"] !== id) throw new Error("Metadata ID disagrees with filename")
  if (!body.trim()) throw new Error("Empty role body")
  for (const key of ["name", "description", "category", "source_revision", "source"])
    if (f[key] !== undefined && typeof f[key] !== "string") throw new Error(`Invalid ${key} metadata`)
  const name = typeof f["name"] === "string" && f["name"].trim() ? f["name"].trim() : titleFromId(id)
  const category = typeof f["category"] === "string" && f["category"].trim() ? f["category"].trim() : folderCategory
  return {
    id,
    name,
    description: typeof f["description"] === "string" ? f["description"] : "",
    category,
    source,
    sourcePath: file,
    body,
    sourceRevision: f["source_revision"] as string | undefined,
    sourceUrl: f["source"] as string | undefined,
  }
}

async function scan(root: RoleRoot, diagnostics: string[]): Promise<Map<string, Entry>> {
  const entries = new Map<string, Entry>()
  const duplicates = new Set<string>()
  let canonicalRoot: string
  try {
    canonicalRoot = await realpath(root.directory)
    if (!(await stat(canonicalRoot)).isDirectory()) return entries
  } catch {
    return entries
  }
  async function walk(dir: string): Promise<void> {
    let files: Dirent[]
    try {
      files = await readdir(dir, { withFileTypes: true })
    } catch {
      diagnostics.push(`${dir}: unreadable directory`)
      return
    }
    for (const entry of files.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue
        await walk(file)
        continue
      }
      if (!entry.name.endsWith(".md")) continue
      const id = path.basename(entry.name, ".md")
      if (!isRoleId(id)) {
        diagnostics.push(`${file}: invalid filename ID`)
        continue
      }
      if (entries.has(id)) {
        duplicates.add(id)
        entries.set(id, "invalid")
        diagnostics.push(`${root.source}: ambiguous role ID ${id}`)
        continue
      }
      try {
        const resolved = await realpath(file)
        const relative = path.relative(canonicalRoot, resolved)
        if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative))
          throw new Error("Role link leaves scope root")
        const content = await readFile(file, "utf8")
        try {
          const folder = path.relative(canonicalRoot, dir).split(path.sep)[0] ?? ""
          entries.set(id, parseRoleDocument(content, file, root.source, folder))
        } catch (error) {
          entries.set(id, "invalid")
          diagnostics.push(`${file}: ${String(error)}`)
        }
      } catch (error) {
        entries.set(id, "unreadable")
        diagnostics.push(`${file}: ${String(error)}`)
      }
    }
  }
  await walk(canonicalRoot)
  for (const id of duplicates) entries.set(id, "invalid")
  return entries
}

/** Nearest `<dir>/.opencode/roles`, walking up from `cwd`. */
export async function nearestProjectRolesRoot(cwd: string): Promise<string | undefined> {
  let dir = path.resolve(cwd)
  for (;;) {
    const candidate = path.join(dir, ".opencode", "roles")
    try {
      if ((await stat(candidate)).isDirectory()) return candidate
    } catch {}
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

export interface DiscoverOptions {
  /** Session or location directory used to find `<project>/.opencode/roles`. */
  readonly directory?: string | undefined
  readonly home?: string | undefined
  /** Explicit roots (tests); highest precedence first. Overrides directory/home. */
  readonly roots?: readonly RoleRoot[] | undefined
}

export async function roleRoots(options: DiscoverOptions = {}): Promise<RoleRoot[]> {
  if (options.roots) return [...options.roots]
  const home = options.home ?? os.homedir()
  const project = options.directory ? await nearestProjectRolesRoot(options.directory) : undefined
  return [
    ...(project ? [{ source: "project" as const, directory: project }] : []),
    { source: "shared", directory: path.join(home, ".agents", "roles") },
    { source: "pi", directory: path.join(home, ".pi", "agent", "roles") },
  ]
}

/** Fresh filesystem snapshot. No network, no caching. */
export async function discoverRoles(options: DiscoverOptions = {}): Promise<RoleCatalog> {
  const roots = await roleRoots(options)
  const diagnostics: string[] = []
  const scanned = await Promise.all(roots.map((root) => scan(root, diagnostics)))
  // Lowest precedence first so that higher roots overwrite the same ID.
  const merged = new Map<string, Entry>()
  for (const entries of scanned.toReversed()) for (const [id, entry] of entries) merged.set(id, entry)
  const roles: RoleDocument[] = []
  const rejected: RoleCatalog["rejected"] = new Map()
  for (const [id, entry] of merged) {
    if (typeof entry === "string") rejected.set(id, entry)
    else roles.push(entry)
  }
  return { roles: roles.sort((a, b) => a.id.localeCompare(b.id)), diagnostics, rejected, roots }
}

/** Short-lived catalog cache for hot paths (one scan per directory per `ttlMs`). */
export function createCatalogCache(ttlMs = 5000, discover = discoverRoles) {
  const cache = new Map<string, { at: number; catalog: Promise<RoleCatalog> }>()
  return {
    get(options: DiscoverOptions = {}): Promise<RoleCatalog> {
      const key = JSON.stringify([options.directory ?? "", options.home ?? "", options.roots ?? null])
      const hit = cache.get(key)
      const now = Date.now()
      if (hit && now - hit.at < ttlMs) return hit.catalog
      const catalog = discover(options)
      cache.set(key, { at: now, catalog })
      catalog.catch(() => cache.delete(key))
      return catalog
    },
    clear() {
      cache.clear()
    },
  }
}
