// End-to-end check of the roles plugin inside a real, sandboxed OpenCode 2.1.3 server talking to a fake model.
import { readFileSync, writeFileSync } from "node:fs"
import { OpenCode } from "D:/tools/opencode-roles/node_modules/@opencode/client/dist/promise/index.js"

const LOG = "D:/claude-cache/oc-sandbox/requests.jsonl"
const password = /server password (\S+)/.exec(readFileSync("D:/claude-cache/oc-sandbox/serve.log", "utf8"))?.[1]
const client = OpenCode.make({
  baseUrl: "http://127.0.0.1:47200",
  headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` },
}) as any
const location = { directory: "D:/claude-cache/oc-sandbox/work" }
const KEY = "opencode-roles"
const results: { name: string; ok: boolean; detail?: string }[] = []
const check = (name: string, ok: boolean, detail?: string) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`)
}
const requests = () =>
  readFileSync(LOG, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
const textOf = (content: unknown): string =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((p: any) => p?.text ?? "").join("") : ""
const systemOf = (body: any) => body.messages.filter((m: any) => m.role === "system").map((m: any) => textOf(m.content)).join("\n")
const lastUser = (body: any) => textOf([...body.messages].reverse().find((m: any) => m.role === "user")?.content)

writeFileSync(LOG, "")

async function turn(sessionID: string, text: string) {
  const before = requests().length
  await client.session.prompt({ sessionID, text })
  await client.session.wait({ sessionID })
  await Bun.sleep(300)
  return requests().slice(before)
}
async function newSession(title: string) {
  return (await client.session.create({ location, title })).id as string
}
async function setRole(sessionID: string, role?: { id: string; name: string }) {
  const info = await client.session.get({ sessionID })
  const metadata = { ...(info.metadata ?? {}) }
  if (role) metadata[KEY] = role
  else delete metadata[KEY]
  await client.session.update({ sessionID, metadata })
}
const mainRequest = (batch: any[], marker: string) => batch.find((r) => lastUser(r.body).includes(marker) && r.body.tools?.length)

// 0. Plugin loaded by OpenCode itself
const plugins = await client.plugin.list({ location })
const ours = (plugins.data ?? plugins).find((p: any) => JSON.stringify(p).includes("opencode-roles"))
check("OpenCode loaded the plugin (server)", !!ours && ours.state?.status === "active", JSON.stringify({ id: ours?.id, state: ours?.state, features: ours?.features }))

// 1. Session with no role
const s1 = await newSession("roles e2e 1")
let batch = await turn(s1, "hello E2E-NONE")
let req = mainRequest(batch, "E2E-NONE")
check("default session: no role text in system prompt", !!req && !systemOf(req.body).includes("Current professional role"))
const toolNames: string[] = (req?.body.tools ?? []).map((t: any) => t.function?.name)
check("roles tool offered to the model", toolNames.includes("roles"), toolNames.join(","))
const subagentTool = req?.body.tools.find((t: any) => t.function?.name === "subagent")
check("subagent tool description mentions --role", !!subagentTool?.function?.description?.includes("--role <id>"))

// 2. Activate Historian
await setRole(s1, { id: "historian", name: "Historian" })
batch = await turn(s1, "second E2E-HIST")
req = mainRequest(batch, "E2E-HIST")
const sys2 = req ? systemOf(req.body) : ""
check("active role injected into system prompt", sys2.includes("Current professional role: Historian (historian)\n\nApply this professional perspective within the requested task."))
check("role body included", sys2.includes("# Historian") || sys2.toLowerCase().includes("historian"))

// 3. Switch to Anthropologist: previous text gone
await setRole(s1, { id: "anthropologist", name: "Anthropologist" })
batch = await turn(s1, "third E2E-ANTH")
req = mainRequest(batch, "E2E-ANTH")
const sys3 = req ? systemOf(req.body) : ""
check("role change: new role present", sys3.includes("Current professional role: Anthropologist (anthropologist)"))
check("role change: previous role removed", !sys3.includes("Current professional role: Historian"))
check("exactly one role block", (sys3.match(/Current professional role:/g) ?? []).length === 1)

// 4. Clear
await setRole(s1, undefined)
batch = await turn(s1, "fourth E2E-CLEAR")
req = mainRequest(batch, "E2E-CLEAR")
check("cleared role: no role text", !!req && !systemOf(req.body).includes("Current professional role"))

// 5. New session starts on default even while s1 has a role
await setRole(s1, { id: "historian", name: "Historian" })
const s2 = await newSession("roles e2e 2")
batch = await turn(s2, "fresh E2E-FRESH")
req = mainRequest(batch, "E2E-FRESH")
check("new session starts on default", !!req && !systemOf(req.body).includes("Current professional role"))

// 6. Subagent with --role historian
batch = await turn(s2, "delegate E2E-SUBAGENT-OK")
const child = batch.find((r) => lastUser(r.body).includes("You are a subagent spawned"))
const childUser = child ? lastUser(child.body) : ""
check("subagent prompt gets the role prepended", childUser.includes("Current professional role: Historian (historian)"), childUser.slice(0, 120).replace(/\n/g, "\\n"))
check("subagent prompt has the flag stripped", !childUser.includes("--role") && childUser.includes("Summarise the Peace of Westphalia in one line."))
check("subagent system prompt has no main-session role", !!child && !systemOf(child.body).includes("Current professional role"))

// 7. Unknown role fails the delegation with suggestions
batch = await turn(s2, "delegate E2E-SUBAGENT-BAD")
const afterBad = batch.find((r) => r.body.messages.at(-1)?.role === "tool")
const toolText = afterBad ? textOf(afterBad.body.messages.at(-1).content) : ""
check("unknown --role fails with close matches", toolText.includes("Unknown role: historain") && toolText.includes("Did you mean: historian"), toolText.slice(0, 160))
check("no child session for the failed delegation", !batch.some((r) => lastUser(r.body).includes("Summarise it.")))

// 8. roles tool
batch = await turn(s2, "list E2E-ROLES-TOOL")
const afterTool = batch.find((r) => r.body.messages.at(-1)?.role === "tool")
const rolesText = afterTool ? textOf(afterTool.body.messages.at(-1).content) : ""
check("roles tool lists the real catalog", rolesText.includes("root-cause-debugger") && rolesText.includes('"total"'), rolesText.slice(0, 120).replace(/\n/g, " "))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
