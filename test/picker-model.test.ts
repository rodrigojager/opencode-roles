import { afterAll, describe, expect, test } from "bun:test"
import {
  buildPickerItems,
  DEFAULT_VALUE,
  filterPickerItems,
  maxVisibleCards,
  moveSelection,
  selectionFor,
  visibleWindow,
} from "../plugin/src/picker-model.ts"
import { cleanup, sampleCatalog } from "./fixtures.ts"

afterAll(cleanup)

describe("picker items", () => {
  test("default (no role) entry comes first", async () => {
    const { catalog } = await sampleCatalog()
    const items = buildPickerItems(catalog.roles)
    expect(items[0]?.value).toBe(DEFAULT_VALUE)
    expect(items[0]?.name).toBe("default (no role)")
    expect(items.slice(1).map((i) => i.value)).toEqual(catalog.roles.map((r) => r.id))
    expect(buildPickerItems(catalog.roles, false)[0]?.value).toBe("anthropologist")
  })
  test("filtering: all words, accents ignored, default entry only when it matches", async () => {
    const { catalog } = await sampleCatalog()
    const items = buildPickerItems(catalog.roles)
    const values = (q: string) => filterPickerItems(items, q).map((i) => i.value)
    expect(values("")).toHaveLength(7)
    expect(values("acad hist")).toEqual(["historian"])
    expect(values("usuário")).toEqual(["ux-researcher"])
    expect(values("no role")).toEqual([DEFAULT_VALUE])
    expect(values("engineering")).toEqual(["backend-architect", "frontend-developer", "root-cause-debugger"])
  })
  test("ranking: a role named by the query comes before roles that only mention it", () => {
    const item = (value: string, name: string, category: string, description: string) => ({ value, name, category, description, searchText: value })
    const items = [
      item("local-environment-setup", "Local Environment Setup Engineer", "custom-engineering", "Prefer Root Cause Debugger for defects"),
      item("root-cause-debugger", "Root Cause Debugger", "custom-engineering", "Diagnose a failure"),
      item("debug-cat", "Something", "debugger root cause", "x"),
    ]
    expect(filterPickerItems(items, "root cause debugger").map((i) => i.value)).toEqual([
      "root-cause-debugger",
      "debug-cat",
      "local-environment-setup",
    ])
    expect(selectionFor(filterPickerItems(items, "root cause debugger"), "root cause debugger", DEFAULT_VALUE)).toBe(0)
  })
})

describe("selection (the Enter-on-empty-search bug)", () => {
  test("empty query highlights the active entry, or default when no role is active — never the first role", async () => {
    const { catalog } = await sampleCatalog()
    const items = buildPickerItems(catalog.roles)
    expect(items[selectionFor(items, "", DEFAULT_VALUE)]?.value).toBe(DEFAULT_VALUE)
    expect(items[selectionFor(items, "   ", "historian")]?.value).toBe("historian")
    // An active role that vanished from the catalog falls back to default, not to the first role.
    expect(items[selectionFor(items, "", "deleted-role")]?.value).toBe(DEFAULT_VALUE)
  })
  test("a non-empty query highlights the first match", async () => {
    const { catalog } = await sampleCatalog()
    const matches = filterPickerItems(buildPickerItems(catalog.roles), "academic")
    expect(selectionFor(matches, "academic", "historian")).toBe(0)
  })
  test("arrows wrap through the whole list; pages clamp", () => {
    expect(moveSelection(0, -1, 5)).toBe(4)
    expect(moveSelection(4, 1, 5)).toBe(0)
    expect(moveSelection(2, 1, 5)).toBe(3)
    expect(moveSelection(1, -7, 5)).toBe(0)
    expect(moveSelection(3, 7, 5)).toBe(4)
    expect(moveSelection(0, 1, 0)).toBe(0)
  })
  test("window follows the selection over the whole list, centred like Pi", () => {
    expect(visibleWindow(286, 0, 7)).toEqual({ start: 0, end: 7 })
    expect(visibleWindow(286, 3, 7)).toEqual({ start: 0, end: 7 })
    expect(visibleWindow(286, 10, 7)).toEqual({ start: 7, end: 14 })
    expect(visibleWindow(286, 285, 7)).toEqual({ start: 279, end: 286 })
    expect(visibleWindow(3, 2, 7)).toEqual({ start: 0, end: 3 })
    expect(visibleWindow(0, 0, 7)).toEqual({ start: 0, end: 0 })
    for (let selected = 0; selected < 286; selected++) {
      const { start, end } = visibleWindow(286, selected, 7)
      expect(selected >= start && selected < end).toBe(true)
    }
  })
  test("card budget follows the terminal height (max 7)", () => {
    expect(maxVisibleCards(60)).toBe(7)
    expect(maxVisibleCards(40)).toBe(7)
    expect(maxVisibleCards(30)).toBe(5)
    expect(maxVisibleCards(20)).toBe(2)
    expect(maxVisibleCards(5)).toBe(1)
  })
})
