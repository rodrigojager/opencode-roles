/** @jsxImportSource @opentui/solid */
// The TUI plugin's setup() against a fake OpenCode v2 TUI context.
import { afterAll, afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { JSX } from "@opentui/solid"
import { createStore, produce } from "solid-js/store"
import { discoverRoles } from "../plugin/src/discovery.ts"
import { METADATA_KEY } from "../plugin/src/session-role.ts"
import { createTuiPlugin } from "../plugin/tui.tsx"
import { cleanup, sampleCatalog } from "./fixtures.ts"
import { fakeKeymap, testTheme } from "./tui-helpers.ts"

afterAll(cleanup)
let mounted: { renderer: { destroy(): void } }[] = []
afterEach(() => {
  for (const setup of mounted) setup.renderer.destroy()
  mounted = []
})

async function until(check: () => boolean, label = "condition") {
  for (let i = 0; i < 200; i++) {
    if (check()) return
    await Bun.sleep(5)
  }
  throw new Error(`timed out waiting for ${label}`)
}

type Session = { id: string; metadata?: Record<string, unknown>; location: { directory: string }; time: { created: number } }

async function host() {
  const { roots } = await sampleCatalog()
  const [sessions, setSessions] = createStore<Record<string, Session>>({
    s1: { id: "s1", metadata: { other: "kept" }, location: { directory: "D:/project" }, time: { created: 1 } },
    s2: { id: "s2", location: { directory: "D:/project" }, time: { created: 2 } },
  })
  const updates: { sessionID: string; metadata: Record<string, unknown> }[] = []
  const created: { id: string; location: { directory: string }; metadata?: Record<string, unknown> }[] = []
  const toasts: { message: string; variant?: string }[] = []
  const keys = fakeKeymap()
  const slots: any[] = []
  const listeners = new Map<string, (event: any) => void>()
  const dialog: { render?: () => JSX.Element; onClose?: () => void } = {}
  let route: any = { type: "session", sessionID: "s1" }
  const context = {
    options: {},
    location: { directory: "D:/project" },
    theme: { ...(testTheme as object), surface: () => testTheme },
    storage: {
      memory: (_key: string, options: { initial: object }) => {
        const [state, set] = createStore(structuredClone(options.initial))
        return [state, (mutation: (draft: any) => void) => set(produce(mutation))]
      },
    },
    ui: {
      toast: { show: (options: any) => toasts.push(options) },
      dialog: {
        show: (render: () => JSX.Element, onClose?: () => void) => {
          const previous = dialog.onClose
          dialog.render = render
          dialog.onClose = onClose
          previous?.()
        },
        set: () => {},
        clear: () => {
          const close = dialog.onClose
          dialog.render = undefined
          dialog.onClose = undefined
          close?.()
        },
      },
      router: {
        current: () => route,
        navigate: (destination: any) => {
          route = destination
        },
      },
      slot: (claim: any) => {
        slots.push(claim)
        return () => {}
      },
      format: { path: (value: string) => value },
    },
    keymap: { layer: keys.layer, shortcuts: keys.shortcuts },
    data: {
      on: (type: string, handler: (event: any) => void) => {
        listeners.set(type, handler)
        return () => listeners.delete(type)
      },
      location: { default: () => ({ directory: "D:/project" }) },
      session: {
        get: (id: string) => sessions[id],
        invalidate: () => {},
        sync: async () => {},
      },
    },
    client: {
      session: {
        get: async ({ sessionID }: { sessionID: string }) => JSON.parse(JSON.stringify(sessions[sessionID])),
        update: async ({ sessionID, metadata }: { sessionID: string; metadata: Record<string, unknown> }) => {
          updates.push({ sessionID, metadata })
          setSessions(sessionID, { metadata }) // replaces the metadata object, like the server
        },
        create: async (input: { location: { directory: string }; metadata?: Record<string, unknown> }) => {
          const id = `new-${created.length + 1}`
          created.push({ id, ...input })
          setSessions(id, { id, metadata: input.metadata, location: input.location, time: { created: Date.now() } })
          return sessions[id]
        },
      },
    },
  }
  const plugin = createTuiPlugin({ discover: (options) => discoverRoles({ ...options, roots }), enterGuardMs: 0, indicator: { inline: false } })
  await plugin.setup(context as never)
  const command = (name: string) => {
    for (const factory of keys.layers)
      for (const item of factory().commands ?? []) if (item.slash?.name === name) return item
    throw new Error(`no /${name}`)
  }
  const run = (name: string, input?: string) => command(name).run(input)
  const renderDialog = async () => {
    await until(() => dialog.render !== undefined, "dialog")
    const render = dialog.render!
    const setup = await testRender(() => render(), { width: 90, height: 40 })
    mounted.push(setup)
    await setup.renderOnce()
    await Bun.sleep(5)
    await setup.renderOnce()
    return setup
  }
  const renderSlot = async (path: string, input: object, width = 60) => {
    const claim = slots.find((item) => item.prepend === path || item.append === path)
    const setup = await testRender(() => claim.render(input), { width, height: 3 })
    mounted.push(setup)
    await setup.renderOnce()
    return setup.captureCharFrame()
  }
  return {
    sessions, updates, created, toasts, keys, slots, listeners, dialog, command, run, renderDialog, renderSlot,
    setRoute: (next: any) => {
      route = next
    },
    route: () => route,
    setSession: (id: string, value: Session) => setSessions(id, value),
  }
}

const roleOf = (h: Awaited<ReturnType<typeof host>>, id: string) => (h.sessions[id]?.metadata as any)?.[METADATA_KEY]

describe("TUI plugin", () => {
  test("registers /role and /roles (with arguments) in the palette and the role indicator", async () => {
    const h = await host()
    expect(h.command("role")).toMatchObject({ id: "roles.select", palette: true, slash: { name: "role", arguments: true } })
    expect(h.command("roles")).toMatchObject({ id: "roles.list", palette: true, slash: { name: "roles", arguments: true } })
    expect(h.slots.map((slot) => slot.prepend ?? slot.append)).toEqual(["prompt.footer.status", "prompt.footer"])
  })

  test("'alt+r roles' hint on the prompt footer line, with the footer's own conditions", async () => {
    const h = await host()
    const normal = { sessionID: "s1", mode: "normal", showDetails: true }
    expect(await h.renderSlot("prompt.footer", normal, 120)).toContain("alt+r roles")
    expect(await h.renderSlot("prompt.footer", { ...normal, showDetails: false }, 120)).not.toContain("alt+r")
    expect(await h.renderSlot("prompt.footer", { ...normal, mode: "shell" }, 120)).not.toContain("alt+r")
    expect(await h.renderSlot("prompt.footer", normal, 80)).not.toContain("alt+r") // narrow: left out
  })

  test("alt+r opens the picker (base-mode layer, i.e. from the prompt)", async () => {
    const h = await host()
    const layer = h.keys.layers.map((factory) => factory()).find((item) => item.commands?.some((c) => c.bind === "alt+r"))
    expect(layer).toBeDefined()
    expect(layer?.mode).toBeUndefined() // base mode: the prompt on home and in sessions, not inside dialogs
    h.keys.press("alt+r")
    const picker = await h.renderDialog()
    expect(picker.captureCharFrame()).toContain("Role for this session")
  })

  test("/role <id> activates directly, keeping other metadata; /role none clears it", async () => {
    const h = await host()
    h.run("role", "historian")
    await until(() => h.updates.length === 1, "update")
    expect(h.updates[0]).toEqual({ sessionID: "s1", metadata: { other: "kept", [METADATA_KEY]: { id: "historian", name: "Historian" } } })
    expect(h.toasts.at(-1)).toMatchObject({ message: "Role: Historian", variant: "success" })
    expect(await h.renderSlot("prompt.footer.status", { sessionID: "s1" })).toContain("Role: Historian")
    h.run("role", "none")
    await until(() => h.updates.length === 2, "clear")
    expect(h.updates[1]?.metadata).toEqual({ other: "kept" })
    expect(await h.renderSlot("prompt.footer.status", { sessionID: "s1" })).toContain("Role: default")
  })

  test("unknown id: error toast with close matches, nothing written", async () => {
    const h = await host()
    h.run("role", "historain")
    await until(() => h.toasts.length > 0, "toast")
    expect(h.toasts[0]).toMatchObject({ variant: "error" })
    expect(h.toasts[0]?.message).toContain("Did you mean: historian")
    expect(h.updates).toEqual([])
  })

  test("/role opens the picker; Enter on the empty search keeps default", async () => {
    const h = await host()
    h.run("role")
    const picker = await h.renderDialog()
    const frame = picker.captureCharFrame()
    expect(frame).toContain("Role for this session")
    expect(frame).toContain("› default (no role) · active")
    h.keys.press("return")
    await until(() => h.toasts.length > 0, "toast")
    expect(h.dialog.render).toBeUndefined()
    expect(h.updates).toEqual([])
    expect(h.toasts[0]?.message).toBe("Already on default (no role).")
  })

  test("/role picker: type, Enter picks; Esc (dialog close) cancels", async () => {
    const h = await host()
    h.run("role")
    const picker = await h.renderDialog()
    await picker.mockInput.typeText("anthro")
    await picker.renderOnce()
    h.keys.press("return")
    await until(() => h.updates.length === 1, "update")
    expect(roleOf(h, "s1")).toEqual({ id: "anthropologist", name: "Anthropologist" })

    h.run("role")
    const again = await h.renderDialog()
    expect(again.captureCharFrame()).toContain("› Anthropologist · academic · active")
    h.dialog.onClose?.() // what the host does on Esc
    h.dialog.render = undefined
    await Bun.sleep(20)
    expect(h.updates).toHaveLength(1)
  })

  test("/role show displays the active role's text", async () => {
    const h = await host()
    h.run("role", "show")
    await until(() => h.toasts.length > 0, "toast")
    expect(h.toasts[0]?.message).toBe("No active role (default).")
    h.run("role", "historian")
    await until(() => h.updates.length === 1, "update")
    h.run("role", "show")
    const preview = await h.renderDialog()
    const frame = preview.captureCharFrame()
    expect(frame).toContain("Active role: Historian (historian)")
    expect(frame).toContain("You are Historian.")
  })

  test("/roles [query] lists (no default entry) and Enter shows the role text", async () => {
    const h = await host()
    h.run("roles", "academic")
    const list = await h.renderDialog()
    const frame = list.captureCharFrame()
    expect(frame).toContain("Roles (6)")
    expect(frame).toContain("2 results")
    expect(frame).not.toContain("default (no role) ·")
    expect(frame).toContain("Enter view")
    const first = h.dialog.render
    h.keys.press("return")
    await until(() => h.dialog.render !== undefined && h.dialog.render !== first, "preview")
    const preview = await h.renderDialog()
    expect(preview.captureCharFrame()).toContain("Role: Anthropologist (anthropologist)")
    expect(h.updates).toEqual([])
  })

  test("sessions are independent; a new session shows default", async () => {
    const h = await host()
    h.run("role", "historian")
    await until(() => h.updates.length === 1, "update")
    expect(await h.renderSlot("prompt.footer.status", { sessionID: "s2" })).toContain("Role: default")
  })

  test("on the home screen a role starts a new session that already carries it", async () => {
    const h = await host()
    h.setRoute({ type: "home" })
    expect(await h.renderSlot("prompt.footer.status", {})).toContain("Role: default")
    h.run("role", "none")
    await until(() => h.toasts.length > 0, "toast")
    expect(h.toasts[0]?.message).toBe("New sessions start on default (no role).")
    expect(h.created).toEqual([])
    h.run("role", "historian")
    await until(() => h.created.length === 1, "session created")
    // The role is in the metadata at creation, before any prompt, so the first request has it.
    expect(h.created[0]).toEqual({
      id: "new-1",
      location: { directory: "D:/project" },
      metadata: { [METADATA_KEY]: { id: "historian", name: "Historian" } },
    })
    await until(() => h.route().type === "session", "navigate")
    expect(h.route()).toEqual({ type: "session", sessionID: "new-1" })
    expect(h.updates).toEqual([])
    expect(await h.renderSlot("prompt.footer.status", { sessionID: "new-1" })).toContain("Role: Historian")
  })
})
