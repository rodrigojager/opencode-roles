// Frontmatter extraction with the same semantics as pi-coding-agent utils/frontmatter.ts,
// plus a small YAML subset parser (no dependency, so the plugin needs no node_modules at runtime).

export interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>
  body: string
}

const normalizeNewlines = (value: string) => value.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
export const stripBom = (value: string) => value.replace(/^﻿/, "")

export function extractFrontmatter(content: string): { yaml: string | null; body: string } {
  const normalized = normalizeNewlines(stripBom(content))
  if (!normalized.startsWith("---")) return { yaml: null, body: normalized }
  const end = normalized.indexOf("\n---", 3)
  if (end === -1) return { yaml: null, body: normalized }
  return { yaml: normalized.slice(4, end), body: normalized.slice(end + 4).trim() }
}

export function parseFrontmatter(content: string): ParsedFrontmatter {
  const { yaml, body } = extractFrontmatter(content)
  if (!yaml) return { frontmatter: {}, body }
  return { frontmatter: parseYaml(yaml), body }
}

const KEY = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)[ \t]*:(?:[ \t]+(.*)|[ \t]*)$/

function indentOf(line: string) {
  return /^[ \t]*/.exec(line)?.[0].length ?? 0
}

function stripComment(value: string) {
  const match = /(^|[ \t])#/.exec(value)
  return (match ? value.slice(0, match.index) : value).trim()
}

function plainScalar(raw: string): unknown {
  const value = raw.trim()
  if (value === "" || value === "~" || value === "null" || value === "Null" || value === "NULL") return null
  if (/^(true|True|TRUE)$/.test(value)) return true
  if (/^(false|False|FALSE)$/.test(value)) return false
  if (/^[-+]?(?:0|[1-9][0-9_]*)(?:\.[0-9_]+)?(?:[eE][-+]?[0-9]+)?$/.test(value)) return Number(value.replace(/_/g, ""))
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim()
    return inner ? inner.split(",").map((item) => scalarFromText(item.trim())) : []
  }
  if (value.startsWith("{") && value.endsWith("}")) return {}
  return value
}

function scalarFromText(value: string): unknown {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) return unescapeDouble(value.slice(1, -1))
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) return value.slice(1, -1).replace(/''/g, "'")
  return plainScalar(value)
}

function unescapeDouble(value: string) {
  return value.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (_, code: string) => {
    switch (code[0]) {
      case "n":
        return "\n"
      case "t":
        return "\t"
      case "r":
        return "\r"
      case "0":
        return "\0"
      case "b":
        return "\b"
      case "e":
        return "\x1b"
      case " ":
        return " "
      case "/":
        return "/"
      case "x":
      case "u":
      case "U":
        return String.fromCodePoint(Number.parseInt(code.slice(1), 16))
      default:
        return code
    }
  })
}

/** Fold continuation lines of a flow scalar the way YAML does: single breaks become spaces, blank lines newlines. */
function foldLines(lines: string[]) {
  let out = ""
  let pendingBreaks = 0
  lines.forEach((line, index) => {
    const text = index === 0 ? line : line.trim()
    if (index > 0 && text === "") {
      pendingBreaks++
      return
    }
    if (index > 0) out += pendingBreaks > 0 ? "\n".repeat(pendingBreaks) : " "
    pendingBreaks = 0
    out += text
  })
  return out
}

/**
 * Parses the YAML subset used by role frontmatter: top-level `key: value` pairs whose values are
 * plain, single-quoted, double-quoted (multi-line allowed), block (`|` / `>`) scalars, or simple
 * nested lists/maps (kept only so that they are not mistaken for strings). Throws on malformed input,
 * like a YAML parser would, so that the role is rejected with a diagnostic.
 */
export function parseYaml(source: string): Record<string, unknown> {
  const lines = source.split("\n")
  const result: Record<string, unknown> = {}
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ""
    if (line.trim() === "" || /^\s*#/.test(line)) {
      i++
      continue
    }
    if (indentOf(line) > 0) throw new Error(`Unexpected indentation on frontmatter line ${i + 1}`)
    if (line === "---" || line === "...") {
      i++
      continue
    }
    const match = KEY.exec(line)
    if (!match) throw new Error(`Invalid frontmatter line ${i + 1}: ${line.slice(0, 60)}`)
    const key = match[1] ?? ""
    if (Object.hasOwn(result, key)) throw new Error(`Duplicate frontmatter key: ${key}`)
    const raw = match[2] ?? ""
    i++
    // Collect the following more-indented (or blank) lines that belong to this key.
    const start = i
    while (i < lines.length) {
      const next = lines[i] ?? ""
      if (next.trim() !== "" && indentOf(next) === 0) break
      i++
    }
    const nested = lines.slice(start, i)
    while (nested.length && (nested.at(-1) ?? "").trim() === "") nested.pop()
    result[key] = parseValue(raw, nested, key)
  }
  return result
}

function parseValue(raw: string, nested: string[], key: string): unknown {
  const value = raw.trim()
  if (value.startsWith('"')) {
    const text = foldLines([value, ...nested])
    const end = findClosingDouble(text)
    if (end === -1) throw new Error(`Unterminated double-quoted value for ${key}`)
    if (stripComment(text.slice(end + 1)) !== "") throw new Error(`Unexpected text after quoted value for ${key}`)
    return unescapeDouble(text.slice(1, end))
  }
  if (value.startsWith("'")) {
    const text = foldLines([value, ...nested])
    const end = findClosingSingle(text)
    if (end === -1) throw new Error(`Unterminated single-quoted value for ${key}`)
    if (stripComment(text.slice(end + 1)) !== "") throw new Error(`Unexpected text after quoted value for ${key}`)
    return text.slice(1, end).replace(/''/g, "'")
  }
  const block = /^([|>])([+-]?)([1-9]?)([+-]?)\s*(?:#.*)?$/.exec(value)
  if (block) {
    const style = block[1]
    const chomp = block[2] || block[4]
    const indent = Math.min(...nested.filter((l) => l.trim() !== "").map(indentOf), Number.POSITIVE_INFINITY)
    const content = nested.map((l) => (l.trim() === "" ? "" : l.slice(Number.isFinite(indent) ? indent : 0)))
    let text: string
    if (style === "|") text = content.join("\n")
    else {
      text = ""
      content.forEach((l, index) => {
        if (index === 0) text = l
        else if (l === "" || /^\s/.test(l) || content[index - 1] === "") text += `\n${l}`
        else text += ` ${l}`
      })
    }
    if (chomp === "-") return text.replace(/\n+$/, "")
    if (chomp === "+") return `${text}\n`
    return `${text.replace(/\n+$/, "")}\n`
  }
  if (value === "" || value.startsWith("#")) {
    const items = nested.filter((l) => l.trim() !== "" && !/^\s*#/.test(l))
    if (items.length === 0) return null
    if (items.every((l) => /^\s*- /.test(l) || /^\s*-$/.test(l)))
      return items.map((l) => scalarFromText(stripComment(l.replace(/^\s*-\s?/, ""))))
    const object: Record<string, unknown> = {}
    for (const item of items) {
      const entry = KEY.exec(item.trim())
      if (entry) object[entry[1] ?? ""] = scalarFromText(stripComment(entry[2] ?? ""))
    }
    return object
  }
  // Plain scalar, possibly continued on more-indented lines.
  const text = foldLines([stripComment(value), ...nested.map((l) => stripComment(l))])
  if (/:\s/.test(text)) throw new Error(`Plain value for ${key} contains ": "; quote it`)
  return plainScalar(text)
}

function findClosingDouble(text: string) {
  for (let index = 1; index < text.length; index++) {
    if (text[index] === "\\") {
      index++
      continue
    }
    if (text[index] === '"') return index
  }
  return -1
}

function findClosingSingle(text: string) {
  for (let index = 1; index < text.length; index++) {
    if (text[index] === "'") {
      if (text[index + 1] === "'") {
        index++
        continue
      }
      return index
    }
  }
  return -1
}
