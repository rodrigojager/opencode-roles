/** @jsxImportSource @opentui/solid */
// OpenCode v2 TUI plugin: /role picker (also alt+r), /role <id|none|default|show>, /roles [query], role indicator.
import type { Plugin } from "@opencode/plugin/tui"
import { parseRoleCommand } from "./src/commands.ts"
import { unknownRoleMessage } from "./src/delegate.ts"
import { discoverRoles } from "./src/discovery.ts"
import { buildPickerItems, DEFAULT_VALUE } from "./src/picker-model.ts"
import { resolveRole } from "./src/resolver.ts"
import { readStoredRole, type StoredRole, withStoredRole } from "./src/session-role.ts"
import type { RoleCatalog, RoleDocument } from "./src/types.ts"
import { RoleIndicator } from "./ui/indicator.tsx"
import { RolePicker } from "./ui/picker.tsx"
import { RolePreview } from "./ui/preview.tsx"
import { ShortcutHint } from "./ui/shortcut-hint.tsx"

type Context = Plugin.Context

/** Keyboard shortcut that opens the role picker from the prompt. */
export const ROLE_PICKER_KEY = "alt+r"
/** Its command id: the footer hint reads the shortcut from it, and keybind config can rebind it. */
export const ROLE_PICKER_COMMAND = "roles.picker"

export interface TuiPluginOptions {
  /** Catalog loader (tests inject fixed roots). Defaults to a fresh filesystem scan. */
  readonly discover?: typeof discoverRoles
  /** Passed to the picker; tests use 0. */
  readonly enterGuardMs?: number
  /** Indicator placement override; tests without a host prompt use { inline: false }. */
  readonly indicator?: { readonly inline?: boolean; readonly retryMs?: number }
}

export function createTuiPlugin(options: TuiPluginOptions = {}): Plugin.Definition {
  const discover = options.discover ?? discoverRoles
  const enterGuardMs = options.enterGuardMs
  const indicator = options.indicator ?? {}
  return {
  id: "opencode-roles.tui",
  setup(context: Context) {
    const toast = (message: string, variant: "info" | "success" | "warning" | "error" = "info") =>
      context.ui.toast.show({ title: "Roles", message, variant, duration: variant === "error" ? 6000 : 2500 })
    const fail = (error: unknown) => toast(error instanceof Error ? error.message : String(error), "error")
    const dialogTheme = () => context.theme.surface("dialog")
    const layer = (factory: Parameters<Context["keymap"]["layer"]>[0]) => context.keymap.layer(factory)

    const currentSessionID = () => {
      const route = context.ui.router.current()
      return route.type === "session" ? route.sessionID : undefined
    }
    const directoryFor = (sessionID: string | undefined) =>
      (sessionID ? context.data.session.get(sessionID)?.location?.directory : undefined) ??
      (context.location ?? context.data.location.default()).directory
    const activeRole = (sessionID: string | undefined): StoredRole | undefined =>
      sessionID ? readStoredRole(context.data.session.get(sessionID)?.metadata) : undefined
    const catalogFor = (sessionID: string | undefined) => discover({ directory: directoryFor(sessionID) })

    async function writeRole(sessionID: string, role: StoredRole | undefined) {
      const info = await context.client.session.get({ sessionID })
      await context.client.session.update({ sessionID, metadata: withStoredRole(info.metadata, role) as never })
      context.data.session.invalidate(sessionID)
      await context.data.session.sync(sessionID).catch(() => undefined)
    }

    async function setRole(sessionID: string | undefined, role: RoleDocument | undefined) {
      const stored = role ? { id: role.id, name: role.name } : undefined
      if (!sessionID) {
        // Home screen: start the new session with the role already in its metadata, so even its
        // first model request carries the role (no race with the first prompt).
        if (!stored) return toast("New sessions start on default (no role).")
        const location = context.location ?? context.data.location.default()
        const created = await context.client.session.create({
          location: { directory: location.directory },
          metadata: withStoredRole({}, stored) as never,
        })
        await context.data.session.sync(created.id).catch(() => undefined)
        context.ui.router.navigate({ type: "session", sessionID: created.id })
        toast(`New session with role ${stored.name}.`, "success")
        return
      }
      if (activeRole(sessionID)?.id === stored?.id) {
        toast(stored ? `Role ${stored.name} is already active.` : "Already on default (no role).")
        return
      }
      await writeRole(sessionID, stored)
      toast(stored ? `Role: ${stored.name}` : "Role: default (no role)", stored ? "success" : "info")
    }

    function show<T>(render: (finish: (value?: T) => void) => ReturnType<typeof RolePicker>) {
      return new Promise<T | undefined>((resolve) => {
        let settled = false
        const finish = (value?: T) => {
          if (settled) return
          settled = true
          resolve(value)
        }
        context.ui.dialog.show(
          () => render(finish),
          () => finish(undefined),
        )
        context.ui.dialog.set({ size: "large", centered: true })
      })
    }

    function pickRole(catalog: RoleCatalog, current: string, options: { title: string; query?: string; browse?: boolean }) {
      const active = catalog.roles.find((role) => role.id === current)
      const activeLabel =
        current === DEFAULT_VALUE ? "default (no role)" : active ? `${active.name} (${active.id})` : `${current} (not in catalog)`
      const problems = catalog.diagnostics.length
      return show<string>((finish) => (
        <RolePicker
          title={options.title}
          items={buildPickerItems(catalog.roles, !options.browse)}
          current={current}
          activeLabel={activeLabel}
          initialQuery={options.query}
          submitLabel={options.browse ? "view" : "select"}
          note={problems ? `${problems} role file(s) skipped; run /roles to inspect the catalog.` : undefined}
          theme={dialogTheme()}
          layer={layer}
          enterGuardMs={enterGuardMs}
          onPick={(value) => {
            finish(value)
            if (!options.browse) context.ui.dialog.clear()
          }}
          onCancel={() => {
            finish(undefined)
            context.ui.dialog.clear()
          }}
        />
      ))
    }

    function previewRole(role: RoleDocument, active: boolean) {
      const location = context.ui.format.path(role.sourcePath)
      return show<void>((finish) => (
        <RolePreview
          title={`${active ? "Active role" : "Role"}: ${role.name} (${role.id})`}
          subtitle={[role.category, role.source, location].filter(Boolean).join(" · ")}
          body={role.body}
          theme={dialogTheme()}
          layer={layer}
          onClose={() => {
            finish()
            context.ui.dialog.clear()
          }}
        />
      ))
    }

    async function runRole(input: string | undefined) {
      const command = parseRoleCommand(input)
      const sessionID = currentSessionID()
      if (command.kind === "error") return toast(command.message, "error")
      if (command.kind === "clear") return setRole(sessionID, undefined)
      const catalog = await catalogFor(sessionID)
      const current = activeRole(sessionID)
      if (command.kind === "show") {
        if (!current) return toast("No active role (default).")
        const role = resolveRole(catalog, undefined, current.id, "base-conversation")
        const document = catalog.roles.find((item) => item.id === current.id)
        if (role.status !== "resolved" || !document)
          return toast(`Active role ${current.name} (${current.id}) is ${role.status} in the catalog.`, "warning")
        return previewRole(document, true)
      }
      if (command.kind === "set") {
        const role = catalog.roles.find((item) => item.id === command.id)
        if (!role) return toast(unknownRoleMessage(command.id, catalog, catalog.rejected.get(command.id)), "error")
        return setRole(sessionID, role)
      }
      const value = await pickRole(catalog, current?.id ?? DEFAULT_VALUE, {
        title: sessionID ? "Role for this session" : "Role for a new session",
      })
      if (value === undefined) return
      if (value === DEFAULT_VALUE) return setRole(sessionID, undefined)
      const role = catalog.roles.find((item) => item.id === value)
      if (role) await setRole(sessionID, role)
    }

    async function runRoles(input: string | undefined) {
      const sessionID = currentSessionID()
      const catalog = await catalogFor(sessionID)
      if (catalog.diagnostics.length) toast(`${catalog.diagnostics.length} role file(s) skipped:\n${catalog.diagnostics.slice(0, 3).join("\n")}`, "warning")
      if (!catalog.roles.length) return toast("No roles found in .opencode/roles, ~/.agents/roles or ~/.pi/agent/roles.", "warning")
      const current = activeRole(sessionID)?.id ?? DEFAULT_VALUE
      const value = await pickRole(catalog, current, { title: `Roles (${catalog.roles.length})`, query: input?.trim(), browse: true })
      const role = value ? catalog.roles.find((item) => item.id === value) : undefined
      if (role) await previewRole(role, role.id === current)
    }

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "roles.select",
          title: "Choose a role for this session",
          description: "/role [<id>|none|default|show] · alt+r opens the picker",
          group: "Roles",
          palette: true,
          slash: { name: "role", arguments: true },
          run: (input?: string) => void runRole(input).catch(fail),
        },
        {
          id: "roles.list",
          title: "Browse roles",
          description: "/roles [query]",
          group: "Roles",
          palette: true,
          slash: { name: "roles", arguments: true },
          run: (input?: string) => void runRoles(input).catch(fail),
        },
      ],
    }))

    // alt+r opens the picker from the prompt (home screen and sessions). Base mode: not inside dialogs.
    context.keymap.layer(() => ({
      commands: [
        {
          id: ROLE_PICKER_COMMAND,
          bind: ROLE_PICKER_KEY,
          title: "Choose a role for this session",
          group: "Roles",
          run: () => void runRole(undefined).catch(fail),
        },
      ],
    }))

    // One per prompt: attaches "· Role: …" to that prompt's agent · model · effort line.
    const offIndicator = context.ui.slot({
      prepend: "prompt.footer.status",
      render: (props) => (
        <RoleIndicator
          name={() => activeRole(props.sessionID)?.name}
          theme={context.theme}
          inline={indicator.inline}
          retryMs={indicator.retryMs}
          onClick={() => void runRole(undefined).catch(fail)}
        />
      ),
    })

    // "alt+r roles" on the footer line, after OpenCode's "ctrl+p commands".
    const offHint = context.ui.slot({
      append: "prompt.footer",
      render: (props) => (
        <ShortcutHint
          shortcut={() => context.keymap.shortcuts(ROLE_PICKER_COMMAND)[0]}
          visible={props.mode === "normal" && props.showDetails}
          theme={context.theme}
        />
      ),
    })

    return () => {
      offIndicator()
      offHint()
    }
  },
  }
}

export default createTuiPlugin()
