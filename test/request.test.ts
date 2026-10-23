import { describe, expect, test } from "bun:test"
import { parseRoleCommand } from "../plugin/src/commands.ts"
import { hasRolePrefix, isRoleId, normalizeRoleRequest, parseRolePrefix } from "../plugin/src/request.ts"

describe("role ids", () => {
  test("lowercase filename ids; default/none and Windows device names are reserved", () => {
    for (const id of ["historian", "backend-architect", "a.b_c-d", "x1"]) expect(isRoleId(id)).toBe(true)
    for (const id of ["default", "none", "Historian", "-x", "a--b", "con", "lpt1", "nul.md", "", "a b"]) expect(isRoleId(id)).toBe(false)
  })
  test("normalizeRoleRequest", () => {
    expect(normalizeRoleRequest("default")).toEqual({ kind: "default" })
    expect(normalizeRoleRequest("none")).toEqual({ kind: "none" })
    expect(normalizeRoleRequest("historian")).toEqual({ kind: "named", id: "historian" })
    expect(() => normalizeRoleRequest("Bad Id")).toThrow("Invalid role")
  })
})

describe("--role prefix (pi-subagent parseRolePrefix)", () => {
  test("--role <id> and --role=<id> are stripped, task kept intact", () => {
    expect(parseRolePrefix("--role historian Summarise   the war")).toEqual({ role: "historian", task: "Summarise   the war" })
    expect(parseRolePrefix("  --role=historian\nLine 1\nLine 2")).toEqual({ role: "historian", task: "Line 1\nLine 2" })
  })
  test("none/default and the -- terminator", () => {
    expect(parseRolePrefix("--role none do it")).toEqual({ role: "none", task: "do it" })
    expect(parseRolePrefix("--role default -- --role is literal")).toEqual({ role: "default", task: "--role is literal" })
  })
  test("no prefix leaves the text alone", () => {
    expect(parseRolePrefix("Review --role x later")).toEqual({ task: "Review --role x later" })
    expect(hasRolePrefix("Review --role x")).toBe(false)
    expect(hasRolePrefix(" --role x")).toBe(true)
    expect(hasRolePrefix("--role=x")).toBe(true)
    expect(hasRolePrefix("--roles x")).toBe(false)
  })
  test("errors", () => {
    expect(() => parseRolePrefix("--role")).toThrow("--role requires a value.")
    expect(() => parseRolePrefix("--role --x task")).toThrow("--role requires a value.")
    expect(() => parseRolePrefix("--role a --role b task")).toThrow("Duplicate --role option.")
    expect(() => parseRolePrefix("--role Bad task")).toThrow("Invalid role")
  })
})

describe("/role arguments", () => {
  test("parse", () => {
    expect(parseRoleCommand(undefined)).toEqual({ kind: "pick" })
    expect(parseRoleCommand("   ")).toEqual({ kind: "pick" })
    expect(parseRoleCommand("none")).toEqual({ kind: "clear" })
    expect(parseRoleCommand("Default")).toEqual({ kind: "clear" })
    expect(parseRoleCommand("show")).toEqual({ kind: "show" })
    expect(parseRoleCommand("Historian")).toEqual({ kind: "set", id: "historian" })
    expect(parseRoleCommand("a b").kind).toBe("error")
    expect(parseRoleCommand("bad!id").kind).toBe("error")
  })
})
