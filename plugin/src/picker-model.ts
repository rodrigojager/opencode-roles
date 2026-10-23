// Pure state for the role picker (Pi pi-agent-switcher AgentPicker "cards" layout, ported).
import { matchesWords, queryWords } from "./search.ts"
import type { RoleDocument } from "./types.ts"

export const DEFAULT_VALUE = "default"

export interface PickerItem {
  readonly value: string
  readonly name: string
  readonly category: string
  readonly description: string
  readonly searchText: string
}

export const DEFAULT_ITEM: PickerItem = {
  value: DEFAULT_VALUE,
  name: "default (no role)",
  category: "",
  description: "No professional role: the agent's own behaviour and personality.",
  searchText: "default none no role",
}

export function buildPickerItems(roles: readonly RoleDocument[], includeDefault = true): PickerItem[] {
  const items = roles.map((role) => ({
    value: role.id,
    name: role.name,
    category: [role.category, role.source === "project" ? "project" : undefined].filter(Boolean).join(" · "),
    description: role.description.replace(/[\r\n]+/g, " ").trim(),
    searchText: role.id,
  }))
  return includeDefault ? [DEFAULT_ITEM, ...items] : items
}

/**
 * Every query word must match the name, ID, category or description; accents are ignored (Pi's filter).
 * Matches are then ranked so that Enter picks the role the query names: name/ID matches first, then
 * name/ID/category, then description-only matches; the catalog order is kept within each tier.
 */
export function filterPickerItems(items: readonly PickerItem[], query: string): PickerItem[] {
  const words = queryWords(query)
  if (!words.length) return [...items]
  const tier = (item: PickerItem) =>
    matchesWords(`${item.name} ${item.searchText}`, words) ? 0 : matchesWords(`${item.name} ${item.searchText} ${item.category}`, words) ? 1 : 2
  return items
    .filter((item) => matchesWords(`${item.name} ${item.searchText} ${item.category} ${item.description}`, words))
    .map((item, index) => ({ item, index, tier: tier(item) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map((entry) => entry.item)
}

/**
 * Highlight when the list is (re)built: the active entry for an empty query (so Enter on an empty
 * search keeps the current choice, which is "default" when no role is active, never the first role),
 * otherwise the first match.
 */
export function selectionFor(matches: readonly PickerItem[], query: string, current: string): number {
  if (queryWords(query).length) return 0
  const index = matches.findIndex((item) => item.value === current)
  if (index >= 0) return index
  const fallback = matches.findIndex((item) => item.value === DEFAULT_VALUE)
  return fallback >= 0 ? fallback : 0
}

/** ↑/↓ wrap around the whole list (as in Pi); page moves clamp at the ends. */
export function moveSelection(selected: number, delta: number, count: number, wrap = Math.abs(delta) === 1) {
  if (count <= 0) return 0
  if (wrap) return (((selected + delta) % count) + count) % count
  return Math.min(count - 1, Math.max(0, selected + delta))
}

/** Pi's budget: 80% of the terminal minus chrome, cards of 2 rows plus a 1-row gap, at most 7. */
export function maxVisibleCards(terminalRows: number) {
  const rowBudget = Math.max(1, Math.floor(terminalRows * 0.8) - 9)
  return Math.max(1, Math.min(7, Math.floor((rowBudget + 1) / 3)))
}

/** Window of visible cards, keeping the selection centred where possible (Pi). */
export function visibleWindow(count: number, selected: number, maxVisible: number) {
  const size = Math.max(1, maxVisible)
  const start = Math.max(0, Math.min(selected - Math.floor(size / 2), count - size))
  return { start, end: Math.min(count, start + size) }
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })
const defaultWidth = (text: string) =>
  typeof Bun !== "undefined" && typeof Bun.stringWidth === "function" ? Bun.stringWidth(text) : text.length

/** Cuts `text` to `width` terminal cells, ending with "…" when shortened (Pi truncates at the end). */
export function truncateEnd(text: string, width: number, measure = defaultWidth) {
  if (width <= 0) return ""
  if (measure(text) <= width) return text
  let out = ""
  let used = 0
  for (const { segment } of graphemes.segment(text)) {
    const cells = measure(segment)
    if (used + cells > width - 1) break
    out += segment
    used += cells
  }
  return `${out.trimEnd()}…`
}

/** Fits a card's first line ("› " + name + " · category" + " · active") into `width` cells. */
export function fitCardTitle(name: string, category: string, badge: string, width: number, measure = defaultWidth) {
  const prefix = 2
  const categoryText = category ? ` · ${category}` : ""
  const room = width - prefix - measure(badge)
  const nameWidth = measure(name)
  if (nameWidth + measure(categoryText) <= room) return { name, category: categoryText }
  if (nameWidth <= room) {
    const left = room - nameWidth
    return { name, category: left >= 4 ? truncateEnd(categoryText, left, measure) : "" }
  }
  return { name: truncateEnd(name, Math.max(1, room), measure), category: "" }
}

export function resultSummary(count: number) {
  return `${count} result${count === 1 ? "" : "s"}`
}
