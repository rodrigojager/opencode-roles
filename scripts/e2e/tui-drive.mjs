// Drives the real OpenCode 2.1.3 TUI through a pseudo-terminal (bundled ConPTY, so mouse input works),
// against the sandbox (XDG dirs on D:, fake local model). Prints PASS/FAIL lines; screens go to screens.txt.
import pty from "node-pty"
import xterm from "@xterm/headless"
import { appendFileSync, readFileSync, writeFileSync } from "node:fs"

const COLS = 120
const ROWS = 42
const OUT = "D:/claude-cache/tui-drive2/screens.txt"
const REQUESTS = "D:/claude-cache/oc-sandbox/requests.jsonl"
writeFileSync(OUT, "")
writeFileSync(REQUESTS, "")
const env = {
  ...process.env,
  XDG_DATA_HOME: "D:\\claude-cache\\oc-sandbox\\data",
  XDG_CONFIG_HOME: "D:\\claude-cache\\oc-sandbox\\config",
  XDG_STATE_HOME: "D:\\claude-cache\\oc-sandbox\\state",
  XDG_CACHE_HOME: "D:\\claude-cache\\oc-sandbox\\cache",
  FAKE_API_KEY: "fake",
  TERM: "xterm-256color",
  COLORTERM: "truecolor",
}
const term = new xterm.Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true })
const child = pty.spawn("C:\\Users\\Rodrigo\\AppData\\Roaming\\npm\\node_modules\\@opencode\\cli\\bin\\opencode.exe", ["--standalone"], {
  name: "xterm-256color",
  cols: COLS,
  rows: ROWS,
  cwd: "D:\\claude-cache\\oc-sandbox\\work",
  env,
  useConptyDll: true,
})
child.onData((data) => term.write(data))
let exited = false
child.onExit(() => (exited = true))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const lines = () => {
  const buffer = term.buffer.active
  return Array.from({ length: ROWS }, (_, y) => buffer.getLine(buffer.viewportY + y)?.translateToString(true) ?? "")
}
const text = () => lines().join("\n")
function cell(x, y) {
  const c = term.buffer.active.getLine(term.buffer.active.viewportY + y)?.getCell(x)
  return c && { bold: c.isBold() !== 0, dim: c.isDim() !== 0, fg: c.getFgColor().toString(16).padStart(6, "0"), bg: c.getBgColor().toString(16).padStart(6, "0") }
}
/** Position of `needle` on the last row that contains it (footer) or the first (otherwise). */
function find(needle, { last = false, row } = {}) {
  const all = lines()
  const order = last ? [...all.keys()].reverse() : [...all.keys()]
  for (const y of order) {
    if (row && !row.test(all[y])) continue
    const x = all[y].indexOf(needle)
    if (x >= 0) return { x, y, ...cell(x, y) }
  }
}
const snap = (label) => appendFileSync(OUT, `\n===== ${label} =====\n${lines().map((l) => l.trimEnd()).join("\n")}\n`)
async function waitFor(predicate, label, timeout = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (predicate(text())) return
    if (exited) throw new Error(`TUI exited while waiting for ${label}`)
    await sleep(150)
  }
  snap(`TIMEOUT ${label}`)
  throw new Error(`timeout: ${label}`)
}
const type = async (value) => {
  for (const ch of value) {
    child.write(ch)
    await sleep(20)
  }
}
const KEYS = { enter: "\r", esc: "\x1b", down: "\x1b[B", up: "\x1b[A" }
const press = async (k, times = 1) => {
  for (let i = 0; i < times; i++) {
    child.write(KEYS[k])
    await sleep(110)
  }
}
const click = async (x, y) => {
  child.write(`\x1b[<0;${x + 1};${y + 1}M`)
  await sleep(50)
  child.write(`\x1b[<0;${x + 1};${y + 1}m`)
  await sleep(600)
}
const wheel = async (x, y, down = true) => {
  child.write(`\x1b[<${down ? 65 : 64};${x + 1};${y + 1}M`)
  await sleep(200)
}
const results = []
const check = (name, ok, detail) => {
  results.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`)
}
const selected = () => lines().find((l) => l.includes("› "))?.trim()
const openPicker = async (title) => {
  await type("/role ")
  await press("enter")
  await waitFor((t) => t.includes(title), `picker "${title}"`)
  await sleep(400)
}
const agentRequest = (marker) =>
  readFileSync(REQUESTS, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .find((r) => (r.body.tools ?? []).length && JSON.stringify(r.body.messages).includes(marker))
const systemText = (r) => r.body.messages.filter((m) => m.role === "system").map((m) => (typeof m.content === "string" ? m.content : m.content.map((p) => p.text).join(""))).join("\n")

const KEY_ALT_R = "\x1b" + "r" // what a terminal sends for alt+r
const ROLE_RED = "d3542b" // role name, the same in every theme
const ORANGE = "eeeeee" // orng text.base, used for "Role:"
const MUTED = "808080" // orng text.muted
/** The prompt's agent · model · effort line (the last screen line that contains "Build · "). */
const metaLine = () => {
  const all = lines()
  for (let y = all.length - 1; y >= 0; y--) if (/Build · /.test(all[y])) return { y, text: all[y] }
}
const roleOnMetaLine = () => {
  const meta = metaLine()
  if (!meta) return undefined
  const x = meta.text.indexOf("Role:")
  return x >= 0 ? { x, y: meta.y, text: meta.text.trim(), ...cell(x, meta.y), name: cell(x + 6, meta.y) } : { text: meta.text.trim() }
}
const footerLine = () => {
  const all = lines()
  for (let y = all.length - 1; y >= 0; y--) if (/ctrl\+p commands/.test(all[y])) return all[y]
}
const waitToastsGone = () => sleep(2800)

try {
  await waitFor((t) => /Ask anything|What's new/.test(t), "TUI ready", 60000)
  await sleep(1500)
  if (text().includes("What's new")) { await press("esc"); await sleep(800) }
  await waitFor((t) => /Ask anything/.test(t), "prompt ready", 20000)
  await sleep(2500)
  snap("home")
  let role = roleOnMetaLine()
  check("home: 'Role: default' on the agent · model line, muted grey, not bold", !!role?.x && role.fg === MUTED && !role.bold && /Build · .* · Role: default$/.test(role.text), JSON.stringify(role))
  check("home: footer row has no role text (no extra row)", !!footerLine() && !footerLine().includes("Role"), footerLine()?.trim())

  // Effort shown, role after it
  for (let i = 0; i < 4; i++) {
    child.write("\x14") // ctrl+t: cycle model variant (reasoning effort) until one is shown
    await sleep(700)
    if (/· (low|medium|high) · Role:/.test(metaLine()?.text ?? "")) break
  }
  role = roleOnMetaLine()
  snap("home with effort")
  check("role follows the reasoning effort on the same line", /Build · Fake model Fake · (low|medium|high) · Role: default$/.test(role?.text ?? ""), role?.text)

  // alt+r on the home screen
  child.write(KEY_ALT_R)
  await waitFor((t) => t.includes("Role for a new session"), "alt+r picker on home", 8000)
  await sleep(300)
  snap("alt+r on home")
  check("alt+r opens the picker on the home screen", text().includes("› default (no role) · active"))
  await press("esc")
  await sleep(500)

  // Picker look
  await openPicker("Role for a new session")
  snap("picker on home")
  let t = text()
  check("picker: default entry first, highlighted and marked active", /› default \(no role\) · active/.test(t))
  check("picker: two-line cards, category after the name", /3D & Scene Developer · gis/.test(t) && /Web 3D visualization specialist/.test(t))
  check("picker: blank line between cards", (() => { const a = lines(); const i = a.findIndex((l) => l.includes("3D & Scene Developer")); return i > 0 && a[i - 1].trim() === "" && a[i + 2].trim() === "" })())
  check("picker: footer with count and keys", /286 results · 1\/286 · ↑↓ navigate · Enter select · Esc cancel/.test(t))
  await press("enter")
  await sleep(700)
  check("Enter on empty search keeps default (no session created)", !text().includes("Role for a new session") && /Ask anything/.test(text()))

  // Navigation, wheel, filter
  await openPicker("Role for a new session")
  await press("down", 12)
  await sleep(300)
  check("↓ scrolls through the list", text().includes("13/286") && !text().includes("› default"), selected())
  await press("up", 13)
  await sleep(300)
  check("↑ from the top wraps to the last role", text().includes("286/286"), selected())
  const listRow = find("· ", { row: /›/ })
  if (listRow) await wheel(listRow.x, listRow.y, false)
  await sleep(300)
  check("mouse wheel moves the highlight", text().includes("285/286"), selected())
  await type("root cause debugger")
  await sleep(500)
  check("typing filters; the named role ranks first", /3 results · 1\/3/.test(text()) && /› Root Cause Debugger · custom-engineering/.test(text()), selected())
  await press("enter")
  await sleep(1200)
  await waitToastsGone()
  snap("after pick on home")
  role = roleOnMetaLine()
  check("home pick opens a new session; 'Role: Root Cause Debugger' on the model line", !text().includes("Ask anything") && /· Role: Root Cause Debugger$/.test(role?.text ?? ""), role?.text)
  check(`colours: 'Role:' #${ORANGE} (theme base text), name #${ROLE_RED}, both bold, no background`, role?.fg === ORANGE && !!role?.bold && role?.name?.fg === ROLE_RED && !!role?.name?.bold && role?.name?.bg === role?.bg && role?.bg !== "29213d", JSON.stringify(role))
  check("still no role text in the footer row", !footerLine()?.includes("Role"), footerLine()?.trim())
  check("exactly one 'Role:' on screen", lines().filter((l) => l.includes("Role:")).length === 1)

  // First prompt in that session already has the role
  await type("hello E2E-TUI-1")
  await press("enter")
  await waitFor((t) => /^\s+ok\s*$/m.test(t), "model reply")
  await sleep(1000)
  const first = agentRequest("E2E-TUI-1")
  check("first agent request of that session has the role in the system prompt", !!first && systemText(first).includes("Current professional role: Root Cause Debugger (root-cause-debugger)"))

  // alt+r inside a session
  child.write(KEY_ALT_R)
  await waitFor((t) => t.includes("Role for this session"), "alt+r picker in session", 8000)
  await sleep(300)
  check("alt+r opens the picker in a session, active role marked", /› Root Cause Debugger · custom-engineering · active/.test(text()))
  await press("esc")
  await sleep(500)

  // /role none, /role <id>, /role show
  await type("/role none")
  await press("enter")
  await sleep(1000)
  await waitToastsGone()
  role = roleOnMetaLine()
  check("/role none → muted 'Role: default' on the model line", /· Role: default$/.test(role?.text ?? "") && role?.fg === MUTED && !role?.bold, JSON.stringify(role))
  await type("hello E2E-TUI-2")
  await press("enter")
  await sleep(1500)
  const second = agentRequest("E2E-TUI-2")
  check("after /role none the next request has no role text", !!second && !systemText(second).includes("Current professional role"))
  await type("/role historian")
  await press("enter")
  await sleep(1000)
  await waitToastsGone()
  role = roleOnMetaLine()
  check("/role historian activates directly (model line updates)", /· Role: Historian$/.test(role?.text ?? "") && role?.fg === ORANGE && role?.name?.fg === ROLE_RED, JSON.stringify(role))
  await type("hello E2E-TUI-3")
  await press("enter")
  await sleep(1500)
  const third = agentRequest("E2E-TUI-3")
  check("next request has Historian only", !!third && systemText(third).includes("Current professional role: Historian (historian)") && !systemText(third).includes("Root Cause Debugger (root-cause-debugger)"))
  await type("/role show")
  await press("enter")
  await waitFor((t) => t.includes("Active role: Historian (historian)"), "/role show")
  check("/role show displays the role text", /academic · pi/.test(text()))
  await press("esc")
  await sleep(500)

  // Esc cancels; mouse click on a card; click on the indicator
  await openPicker("Role for this session")
  check("picker marks and highlights the active role", /› Historian · academic · active/.test(text()))
  await press("down")
  await press("esc")
  await sleep(600)
  check("Esc cancels without change", !text().includes("Role for this session") && /· Role: Historian$/.test(roleOnMetaLine()?.text ?? ""))
  await openPicker("Role for this session")
  await type("anthropologist")
  await sleep(500)
  const card = find("Anthropologist", { row: /· academic/ })
  if (card) await click(card.x + 2, card.y)
  await sleep(600)
  await waitToastsGone()
  check("mouse click on a card picks it", /· Role: Anthropologist$/.test(roleOnMetaLine()?.text ?? "") && !text().includes("Role for this session"), roleOnMetaLine()?.text)
  role = roleOnMetaLine()
  if (role?.x !== undefined) await click(role.x + 2, role.y)
  await sleep(800)
  check("clicking the role on the model line opens the picker", text().includes("Role for this session"))
  if (text().includes("Role for this session")) await press("esc")
  await sleep(400)

  // /roles
  await type("/roles debug")
  await press("enter")
  await waitFor((t) => t.includes("Roles (285)"), "/roles")
  await sleep(400)
  check("/roles <query> lists matching roles", /4 results/.test(text()) && text().includes("Root Cause Debugger"))
  await press("esc")
  await sleep(400)
} catch (error) {
  console.log("ERROR", error.message)
  snap("error state")
} finally {
  const failed = results.filter((ok) => !ok).length
  console.log(`\n${results.length - failed}/${results.length} TUI checks passed`)
  child.kill()
  setTimeout(() => process.exit(failed ? 1 : 0), 500)
}
