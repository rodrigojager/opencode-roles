import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { discoverRoles } from "../plugin/src/discovery.ts"
import type { RoleRoot } from "../plugin/src/types.ts"

const base = path.join(import.meta.dir, ".tmp")

/** Writes `files` (relative path -> content) under a fresh temp directory and returns it. */
export async function tree(files: Record<string, string>) {
  await mkdir(base, { recursive: true })
  const dir = await mkdtemp(path.join(base, "t-"))
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(dir, relative)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
  }
  return dir
}

export async function cleanup() {
  await rm(base, { recursive: true, force: true })
}

export function role(name: string, description: string, category: string, body = `# ${name}\n\nYou are ${name}.`) {
  return `---\nname: "${name}"\ndescription: "${description}"\ncategory: "${category}"\nsource: https://example.test/${name}\nsource_revision: rev1\n---\n\n${body}\n`
}

/** A small catalog with the real-world shapes (categories in folders, quoted frontmatter). */
export async function sampleCatalog() {
  const pi = await tree({
    "academic/anthropologist.md": role("Anthropologist", "Expert in cultural systems, rituals, kinship", "academic"),
    "academic/historian.md": role("Historian", "Historical analysis and periodization", "academic"),
    "engineering/backend-architect.md": role("Backend Architect", "Senior backend architect for scalable APIs", "engineering"),
    "engineering/frontend-developer.md": role("Frontend Developer", "Modern web UI implementation", "engineering"),
    "design/ux-researcher.md": role("UX Researcher", "Pesquisa de usuário e análise de usabilidade", "design"),
    "custom/root-cause-debugger.md": `---\nname: Root Cause Debugger\ndescription: Diagnose a software failure whose cause is unknown\ncategory: custom-engineering\n---\n\n# Root Cause Debugger\n\nYou investigate a concrete software failure.\n`,
  })
  const roots: RoleRoot[] = [{ source: "pi", directory: pi }]
  return { pi, roots, catalog: await discoverRoles({ roots }) }
}
