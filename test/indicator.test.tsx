/** @jsxImportSource @opentui/solid */
// Role indicator: colours, and rendering inline on a prompt tree shaped like OpenCode 2.1.3's
// (textarea + metadata row inside the prompt box; the plugin's slot in the footer row below).
import { afterEach, describe, expect, test } from "bun:test"
import { TextAttributes } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { RoleIndicator, roleColors } from "../plugin/ui/indicator.tsx"
import { hex, testTheme } from "./tui-helpers.ts"

let mounted: { renderer: { destroy(): void } } | undefined
afterEach(() => {
  mounted?.renderer.destroy()
  mounted = undefined
})

const spanHex = (span: { fg: { toInts(): number[] } }) => `#${span.fg.toInts().slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("")}`
/** The test theme's accent (the picker's selection colour). */
const ACCENT = "#ff8800"

describe("indicator colours", () => {
  test("from the running theme: 'Role:' = base text, the name = accent, default = muted", () => {
    const colors = roleColors(testTheme)
    expect(colors.label.equals(hex("#eeeeee"))).toBe(true)
    expect(colors.active.equals(hex(ACCENT))).toBe(true)
    expect(colors.idle.equals(hex("#999999"))).toBe(true)
  })
})

/** Prompt tree like OpenCode 2.1.3: root > bordered > inner > [textarea, row(space-between) > content(flexGrow 1)], line, footer. */
function FakePrompt(props: { name: () => string | undefined; withTextarea?: boolean }) {
  return (
    <box width="100%">
      <box width="100%" border={["left"]}>
        <box paddingLeft={2} paddingTop={1} width="100%">
          {props.withTextarea === false ? <text>no textarea here</text> : <textarea height={1} />}
          <box flexDirection="row" flexShrink={0} paddingTop={1} gap={1} justifyContent="space-between">
            <box flexDirection="row" gap={1} flexGrow={1} flexShrink={1} minWidth={0}>
              <text>Build</text>
              <text>·</text>
              <text>Fake model</text>
              <text>Fake</text>
              <text>·</text>
              <text attributes={TextAttributes.BOLD}>high</text>
            </box>
          </box>
        </box>
      </box>
      <box height={1} />
      <box width="100%" flexDirection="row" justifyContent="space-between" gap={2}>
        <RoleIndicator name={props.name} theme={testTheme} retryMs={5} />
        <box flexGrow={1}>
          <text>D:\work</text>
        </box>
        <text>ctrl+p commands</text>
      </box>
    </box>
  )
}

async function render(name: string | undefined, withTextarea = true) {
  const [role, setRole] = createSignal<string | undefined>(name)
  const setup = await testRender(() => <FakePrompt name={role} withTextarea={withTextarea} />, { width: 90, height: 12 })
  mounted = setup
  const frame = async () => {
    for (let i = 0; i < 3; i++) await setup.renderOnce()
    return setup.captureCharFrame().split("\n").map((line) => line.trimEnd())
  }
  const spans = () => setup.captureSpans().lines.flatMap((line) => line.spans)
  await frame()
  await Bun.sleep(30)
  return { setup, frame, spans, setRole }
}

type Span = { text: string; fg: { toInts(): number[] }; bg: { a: number }; attributes: number }
/** "Role:" in base text, the name in the accent, both bold, no background. */
function expectActiveSpans(spans: Span[], accent = ACCENT) {
  const label = spans.find((span) => span.text.includes("Role:"))!
  const name = spans.find((span) => span.text.includes("Historian"))!
  expect(spanHex(label)).toBe("#eeeeee")
  expect(spanHex(name)).toBe(accent)
  for (const span of [label, name]) {
    expect(span.attributes & TextAttributes.BOLD).toBeTruthy()
    expect(span.bg.a).toBe(0) // plain text, no background block
  }
}

describe("indicator on the agent · model · effort line", () => {
  test("active role follows the effort on the same line: 'Role:' base, name in the accent, bold; nothing in the footer", async () => {
    const r = await render("Historian")
    const lines = await r.frame()
    const meta = lines.find((line) => line.includes("Build"))!
    expect(meta).toContain("Build · Fake model Fake · high · Role: Historian")
    const footer = lines.find((line) => line.includes("D:\\work"))!
    expect(footer).not.toContain("Role")
    expect(footer.trimStart().startsWith("D:\\work")).toBe(true) // the hidden anchor takes no space or gap
    expect(lines.filter((line) => line.includes("Role:"))).toHaveLength(1)
    expectActiveSpans(r.spans())
  })

  test("no role: muted 'Role: default', not bold; updates live when the role changes", async () => {
    const r = await render(undefined)
    let lines = await r.frame()
    expect(lines.find((line) => line.includes("Build"))).toContain("· high · Role: default")
    const idle = r.spans().find((span) => span.text.includes("Role: default"))!
    expect(spanHex(idle)).toBe("#999999")
    expect(idle.attributes & TextAttributes.BOLD).toBeFalsy()
    r.setRole("Anthropologist")
    lines = await r.frame()
    expect(lines.find((line) => line.includes("Build"))).toContain("· high · Role: Anthropologist")
    r.setRole(undefined)
    lines = await r.frame()
    expect(lines.find((line) => line.includes("Build"))).toContain("· high · Role: default")
  })

  test("a theme switch recolours the name on the line", async () => {
    const [theme, setTheme] = createSignal(testTheme)
    const switched = { ...(testTheme as object), hue: { accent: { 200: hex("#9d7cd8") } } } as typeof testTheme
    const setup = await testRender(
      () => (
        <box width="100%">
          <box>
            <box>
              <textarea height={1} />
              <box flexDirection="row" justifyContent="space-between" gap={1}>
                <box flexDirection="row" flexGrow={1}>
                  <text>Build</text>
                </box>
              </box>
            </box>
          </box>
          <box flexDirection="row">
            <RoleIndicator name={() => "Historian"} theme={theme()} retryMs={5} />
          </box>
        </box>
      ),
      { width: 60, height: 8 },
    )
    mounted = setup
    const spans = async () => {
      for (let i = 0; i < 3; i++) await setup.renderOnce()
      await Bun.sleep(30)
      await setup.renderOnce()
      return setup.captureSpans().lines.flatMap((line) => line.spans)
    }
    expectActiveSpans(await spans())
    setTheme(switched)
    expectActiveSpans(await spans(), "#9d7cd8")
  })

  test("unmounting removes the text and restores the host row", async () => {
    const [show, setShow] = createSignal(true)
    const setup = await testRender(
      () => (
        <box width="100%">
          <box>
            <box>
              <textarea height={1} />
              <box flexDirection="row" justifyContent="space-between" gap={1}>
                <box flexDirection="row" flexGrow={1}>
                  <text>Build</text>
                </box>
              </box>
            </box>
          </box>
          <box flexDirection="row">{show() ? <RoleIndicator name={() => "Historian"} theme={testTheme} retryMs={5} /> : null}</box>
        </box>
      ),
      { width: 60, height: 8 },
    )
    mounted = setup
    for (let i = 0; i < 3; i++) await setup.renderOnce()
    await Bun.sleep(30)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("Build · Role: Historian")
    setShow(false)
    await setup.renderOnce()
    await setup.renderOnce()
    expect(setup.captureCharFrame()).not.toContain("Role")
  })

  test("fallback when the line is not found: plain text in the footer row", async () => {
    const r = await render("Historian", false)
    let lines = await r.frame()
    for (let i = 0; i < 100 && !lines.some((line) => line.includes("Role:")); i++) {
      await Bun.sleep(20) // gives up on the inline line after 30 attempts
      lines = await r.frame()
    }
    expect(lines.find((line) => line.includes("Build"))).not.toContain("Role")
    expect(lines.find((line) => line.includes("D:\\work"))).toContain("Role: Historian")
    expectActiveSpans(r.spans())
  })
})
