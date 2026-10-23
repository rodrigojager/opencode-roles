import { describe, expect, test } from "bun:test"
import { extractFrontmatter, parseFrontmatter, parseYaml } from "../plugin/src/frontmatter.ts"

describe("extractFrontmatter (Pi semantics)", () => {
  test("splits frontmatter and trims the body", () => {
    const { yaml, body } = extractFrontmatter("---\nname: A\n---\n\n# Title\n\nText\n\n")
    expect(yaml).toBe("name: A")
    expect(body).toBe("# Title\n\nText")
  })
  test("strips a BOM and normalises CRLF", () => {
    const { yaml, body } = extractFrontmatter("﻿---\r\nname: A\r\n---\r\nBody\r\n")
    expect(yaml).toBe("name: A")
    expect(body).toBe("Body")
  })
  test("no frontmatter keeps the whole text as body", () => {
    expect(extractFrontmatter("# Just text\n")).toEqual({ yaml: null, body: "# Just text\n" })
  })
  test("unterminated frontmatter is treated as body", () => {
    expect(extractFrontmatter("---\nname: A\nno end").yaml).toBeNull()
  })
})

describe("parseYaml subset", () => {
  test("quoted, plain and URL values", () => {
    const value = parseYaml(
      'name: "Anthropologist"\ndescription: "Expert — builds \\"lived-in\\" societies"\ncategory: academic\nsource: https://github.com/x/y\nsource_revision: 4e3ac3ca\n',
    )
    expect(value).toEqual({
      name: "Anthropologist",
      description: 'Expert — builds "lived-in" societies',
      category: "academic",
      source: "https://github.com/x/y",
      source_revision: "4e3ac3ca",
    })
  })
  test("single quotes, comments, booleans, numbers and null", () => {
    expect(parseYaml("a: 'it''s'\nb: plain # comment\nc: true\nd: 42\ne:\n")).toEqual({
      a: "it's",
      b: "plain",
      c: true,
      d: 42,
      e: null,
    })
  })
  test("block scalars and folded continuation lines", () => {
    expect(parseYaml("lit: |\n  one\n  two\nfold: >-\n  one\n  two\nplain: first\n  second\n")).toEqual({
      lit: "one\ntwo\n",
      fold: "one two",
      plain: "first second",
    })
  })
  test("lists are not strings", () => {
    expect(parseYaml("tools:\n  - read\n  - grep\nflow: [a, b]\n")).toEqual({ tools: ["read", "grep"], flow: ["a", "b"] })
  })
  test("malformed input throws (role becomes invalid, as with a YAML parser)", () => {
    expect(() => parseYaml("name: A\nname: B\n")).toThrow(/Duplicate/)
    expect(() => parseYaml("just words\n")).toThrow(/Invalid frontmatter line/)
    expect(() => parseYaml('name: "open\n')).toThrow(/Unterminated/)
    expect(() => parseYaml("description: a: b\n")).toThrow(/quote it/)
  })
  test("parseFrontmatter combines both", () => {
    expect(parseFrontmatter("---\nname: X\n---\nBody").frontmatter).toEqual({ name: "X" })
  })
})
