/** @jsxImportSource @opentui/solid */
// Headless renders of the real picker / preview components with OpenTUI's test renderer.
import { afterAll, afterEach, describe, expect, test } from "bun:test"
import { TextAttributes } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { buildPickerItems, DEFAULT_VALUE, type PickerItem } from "../plugin/src/picker-model.ts"
import type { RoleDocument } from "../plugin/src/types.ts"
import { RolePicker } from "../plugin/ui/picker.tsx"
import { RolePreview } from "../plugin/ui/preview.tsx"
import { cleanup, sampleCatalog } from "./fixtures.ts"
import { fakeKeymap, hex, testTheme } from "./tui-helpers.ts"

let active: { renderer: { destroy(): void } } | undefined
afterEach(() => {
  active?.renderer.destroy()
  active = undefined
})
afterAll(cleanup)

async function renderPicker(options: { items: PickerItem[]; current?: string; query?: string; width?: number; height?: number }) {
  const keys = fakeKeymap()
  const picked: string[] = []
  let cancelled = 0
  const current = options.current ?? DEFAULT_VALUE
  const setup = await testRender(
    () => (
      <RolePicker
        title="Role for this session"
        items={options.items}
        current={current}
        activeLabel={current === DEFAULT_VALUE ? "default (no role)" : current}
        initialQuery={options.query}
        theme={testTheme}
        layer={keys.layer}
        onPick={(value) => picked.push(value)}
        onCancel={() => cancelled++}
        enterGuardMs={0}
      />
    ),
    { width: options.width ?? 90, height: options.height ?? 40 },
  )
  active = setup
  await setup.renderOnce()
  await Bun.sleep(5) // input autofocus runs on a 1 ms timer
  const frame = async () => {
    await setup.renderOnce()
    return setup.captureCharFrame()
  }
  const press = async (key: string, times = 1) => {
    for (let i = 0; i < times; i++) keys.press(key)
    return frame()
  }
  return { ...setup, keys, picked, cancelled: () => cancelled, frame, press }
}

const lines = (frame: string) => frame.split("\n").map((line) => line.trimEnd())
const selectedLine = (frame: string) => lines(frame).find((line) => line.includes("› "))

function manyRoles(count: number): RoleDocument[] {
  return Array.from({ length: count }, (_, i) => {
    const n = String(i + 1).padStart(3, "0")
    return { id: `role-${n}`, name: `Role ${n}`, description: `Description ${n}`, category: `cat-${i % 3}`, source: "pi", sourcePath: "x", body: "b" }
  })
}

describe("role picker (rendered)", () => {
  test("cards: bold name + dim category, truncated description, blank line between cards, default first", async () => {
    const { catalog } = await sampleCatalog()
    const r = await renderPicker({ items: buildPickerItems(catalog.roles) })
    const frame = await r.frame()
    const text = lines(frame)
    expect(frame).toContain("Role for this session")
    expect(frame).toContain("Active: default (no role)")
    expect(frame).toContain("Search:")
    const first = text.findIndex((line) => line.includes("default (no role) · active"))
    expect(text[first]).toContain("› default (no role) · active")
    expect(text[first + 1]).toContain("No professional role")
    expect(text[first + 2]).toBe("") // separation between cards
    expect(text[first + 3]).toContain("Anthropologist · academic")
    expect(text[first + 4]).toContain("Expert in cultural systems, rituals, kinship")
    expect(frame).toContain("7 results · 1/7 · ↑↓ navigate · Enter select · Esc cancel")
    // Name is bold, category is dimmed (muted colour), highlighted name uses the accent.
    const spans = r.captureSpans().lines.flatMap((line) => line.spans)
    const name = spans.find((span) => span.text.includes("Anthropologist"))!
    expect(name.attributes & TextAttributes.BOLD).toBeTruthy()
    const category = spans.find((span) => span.text.includes("· academic"))!
    expect(category.fg.equals(hex("#999999"))).toBe(true)
    const highlighted = spans.find((span) => span.text.includes("default (no role)") && span.attributes & TextAttributes.BOLD)!
    expect(highlighted.fg.equals(hex("#ff8800"))).toBe(true)
  })

  test("Enter on an empty search keeps default (never picks the first role)", async () => {
    const { catalog } = await sampleCatalog()
    const r = await renderPicker({ items: buildPickerItems(catalog.roles) })
    await r.press("return")
    expect(r.picked).toEqual([DEFAULT_VALUE])
  })

  test("the active role is marked and highlighted; Enter keeps it", async () => {
    const { catalog } = await sampleCatalog()
    const r = await renderPicker({ items: buildPickerItems(catalog.roles), current: "historian" })
    const frame = await r.frame()
    expect(selectedLine(frame)).toContain("› Historian · academic · active")
    await r.press("return")
    expect(r.picked).toEqual(["historian"])
  })

  test("↑/↓ move through the whole list, scrolling, and wrap", async () => {
    const r = await renderPicker({ items: buildPickerItems(manyRoles(40)) })
    let frame = await r.press("down", 40)
    expect(selectedLine(frame)).toContain("Role 040")
    expect(frame).not.toContain("default (no role) · active") // first card scrolled out of view
    expect(frame).toContain("41/41")
    frame = await r.press("down")
    expect(selectedLine(frame)).toContain("default (no role)")
    frame = await r.press("up")
    expect(selectedLine(frame)).toContain("Role 040")
    frame = await r.press("up", 20)
    expect(selectedLine(frame)).toContain("Role 020")
    // Window is centred: 3 cards above and below the selection.
    expect(frame).toContain("Role 017")
    expect(frame).toContain("Role 023")
    expect(frame).not.toContain("Role 016")
    frame = await r.press("pagedown", 10)
    expect(selectedLine(frame)).toContain("Role 040")
    await r.press("return")
    expect(r.picked).toEqual(["role-040"])
  })

  test("typing filters (all words, accents ignored) and Enter picks the first match", async () => {
    const { catalog } = await sampleCatalog()
    const r = await renderPicker({ items: buildPickerItems(catalog.roles) })
    await r.mockInput.typeText("analise")
    let frame = await r.frame()
    expect(frame).toContain("UX Researcher · design")
    expect(frame).not.toContain("Historian")
    expect(frame).toContain("1 result · 1/1")
    await r.mockInput.typeText(" zzz")
    frame = await r.frame()
    expect(frame).toContain("No matching roles")
    expect(frame).toContain("0 results")
    for (let i = 0; i < " zzz".length; i++) r.mockInput.pressBackspace()
    frame = await r.frame()
    expect(selectedLine(frame)).toContain("UX Researcher")
    await r.press("return")
    expect(r.picked).toEqual(["ux-researcher"])
  })

  test("clearing the search re-highlights the active entry", async () => {
    const { catalog } = await sampleCatalog()
    const r = await renderPicker({ items: buildPickerItems(catalog.roles), current: "historian" })
    await r.mockInput.typeText("back")
    expect(selectedLine(await r.frame())).toContain("Backend Architect")
    for (let i = 0; i < 4; i++) r.mockInput.pressBackspace()
    expect(selectedLine(await r.frame())).toContain("Historian")
    await r.press("return")
    expect(r.picked).toEqual(["historian"])
  })

  test("an initial query (from /roles <query>) is applied", async () => {
    const { catalog } = await sampleCatalog()
    const r = await renderPicker({ items: buildPickerItems(catalog.roles, false), query: "academic" })
    const frame = await r.frame()
    expect(frame).toContain("Anthropologist")
    expect(frame).toContain("Historian")
    expect(frame).not.toContain("Backend")
    expect(frame).toContain("2 results")
  })

  test("a mouse click picks the clicked card", async () => {
    const { catalog } = await sampleCatalog()
    const r = await renderPicker({ items: buildPickerItems(catalog.roles) })
    const text = lines(await r.frame())
    const row = text.findIndex((line) => line.includes("Backend Architect"))
    const col = text[row]!.indexOf("Backend Architect") + 2
    await r.mockMouse.click(col, row)
    await r.frame()
    expect(r.picked).toEqual(["backend-architect"])
  })

  test("mouse wheel moves the highlight", async () => {
    const r = await renderPicker({ items: buildPickerItems(manyRoles(20)) })
    const text = lines(await r.frame())
    const row = text.findIndex((line) => line.includes("Role 001"))
    await r.mockMouse.scroll(10, row, "down")
    await r.mockMouse.scroll(10, row, "down")
    expect(selectedLine(await r.frame())).toContain("Role 002")
  })

  test("long descriptions are truncated to one line", async () => {
    const long: RoleDocument = {
      id: "long", name: "Long", category: "c", source: "pi", sourcePath: "x", body: "b",
      description: `Starts here ${"word ".repeat(60)}ENDMARK`,
    }
    const r = await renderPicker({ items: buildPickerItems([long]), width: 70 })
    const frame = await r.frame()
    const line = lines(frame).find((l) => l.includes("Starts here"))!
    expect(line).toMatch(/Starts here (word ?)+\w*…$/) // cut at the end, like Pi
    expect(frame).not.toContain("ENDMARK")
    expect(lines(frame).every((l) => l.length <= 70)).toBe(true)
  })

  test("short terminals show fewer cards but still reach every item", async () => {
    const r = await renderPicker({ items: buildPickerItems(manyRoles(10)), height: 20 })
    let frame = await r.frame()
    expect(lines(frame).filter((line) => /Role \d{3}|default \(no role\)/.test(line) && !line.includes("Active")).length).toBeLessThanOrEqual(2)
    frame = await r.press("down", 10)
    expect(selectedLine(frame)).toContain("Role 010")
  })
})

describe("role text preview (rendered)", () => {
  test("shows title, source line and body; Enter closes", async () => {
    const keys = fakeKeymap()
    let closed = 0
    const body = Array.from({ length: 80 }, (_, i) => `Line ${i + 1}`).join("\n")
    const setup = await testRender(
      () => <RolePreview title="Active role: Historian (historian)" subtitle="academic · pi · ~/x.md" body={body} theme={testTheme} layer={keys.layer} onClose={() => closed++} />,
      { width: 80, height: 30 },
    )
    active = setup
    await setup.renderOnce()
    let frame = setup.captureCharFrame()
    expect(frame).toContain("Active role: Historian (historian)")
    expect(frame).toContain("academic · pi · ~/x.md")
    expect(frame).toContain("Line 1")
    expect(frame).not.toContain("Line 80")
    keys.press("end")
    await setup.renderOnce()
    frame = setup.captureCharFrame()
    expect(frame).toContain("Line 80")
    keys.press("return")
    expect(closed).toBe(1)
  })
})

