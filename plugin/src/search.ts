import type { RoleDocument } from "./types.ts"

/** Lowercase and strip diacritics, so "análise" matches "analise". */
export function normalizeText(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
}

export function queryWords(query: string) {
  return normalizeText(query).trim().split(/\s+/).filter(Boolean)
}

/** Every word of the query must occur in the haystack (accent- and case-insensitive). */
export function matchesWords(haystack: string, words: readonly string[]) {
  if (words.length === 0) return true
  const text = normalizeText(haystack)
  return words.every((word) => text.includes(word))
}

export function roleHaystack(role: Pick<RoleDocument, "id" | "name" | "category" | "description">) {
  return `${role.name} ${role.id} ${role.category} ${role.description}`
}

export function filterRoles<T extends Pick<RoleDocument, "id" | "name" | "category" | "description">>(
  roles: readonly T[],
  query: string,
): T[] {
  const words = queryWords(query)
  return roles.filter((role) => matchesWords(roleHaystack(role), words))
}

export function levenshtein(a: string, b: string) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min((current[j - 1] ?? 0) + 1, (previous[j] ?? 0) + 1, (previous[j - 1] ?? 0) + cost)
    }
    previous = current
  }
  return previous[b.length] ?? 0
}

/** Close matches for an unknown role ID: typos first, then IDs/names sharing its words. */
export function suggestRoles(input: string, roles: readonly RoleDocument[], limit = 5): string[] {
  const needle = normalizeText(input.trim())
  if (!needle) return []
  const parts = needle.split(/[\s._-]+/).filter((part) => part.length >= 3)
  const scored: { id: string; score: number }[] = []
  for (const role of roles) {
    const id = role.id
    const distance = levenshtein(needle, id)
    const tolerance = Math.max(2, Math.floor(id.length / 3))
    let score = Number.POSITIVE_INFINITY
    if (distance <= tolerance) score = distance
    else if (id.includes(needle) || needle.includes(id)) score = tolerance + 1
    else {
      const name = normalizeText(role.name)
      const shared = parts.filter((part) => id.includes(part) || name.includes(part)).length
      if (shared > 0) score = tolerance + 2 + (parts.length - shared)
    }
    if (Number.isFinite(score)) scored.push({ id, score })
  }
  return scored
    .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((entry) => entry.id)
}
