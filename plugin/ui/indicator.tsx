/** @jsxImportSource @opentui/solid */
// Role indicator on the prompt's agent · model · effort line:
//   Build · GPT-5.5 OpenAI · high · Role: Historian
// Active role: "Role:" in the theme's base text colour and the role name in ROLE_NAME_COLOR, both
// bold like the effort. No role: muted "Role: default". OpenCode 2.1.x has no plugin slot on that
// line, so the plugin
// mounts an anchor in its own per-prompt `prompt.footer.status` slot, walks from it to the sibling
// metadata row, and adds one text node there. If that structure is not found (another OpenCode
// version), the label is shown as plain text in the footer row instead.
import type { ResolvedTheme } from "@opencode/theme/tui"
import {
  BoxRenderable,
  bold,
  fg,
  RGBA,
  type Renderable,
  type RenderContext,
  type StyledText,
  t,
  TextareaRenderable,
  TextRenderable,
} from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js"

/** The active role's name, the same in every theme (chosen by the user). */
export const ROLE_NAME_COLOR = "#d3542b"

export function roleLabel(name: string | undefined) {
  return name ? `Role: ${name}` : "Role: default"
}

export function roleColors(theme: ResolvedTheme) {
  return {
    /** "Role:" when a role is active: the theme's default text colour. */
    label: theme.text.base,
    active: RGBA.fromHex(ROLE_NAME_COLOR),
    idle: theme.text.muted,
    separator: theme.text.muted,
  }
}

export function inlineContent(name: string | undefined, theme: ResolvedTheme): StyledText {
  const colors = roleColors(theme)
  return name
    ? t`${fg(colors.separator)("·")} ${bold(fg(colors.label)("Role:"))} ${bold(fg(colors.active)(name))}`
    : t`${fg(colors.separator)("·")} ${fg(colors.idle)(roleLabel(undefined))}`
}

export interface MetadataRow {
  /** The row box that holds the agent · model · effort line (justify space-between in 2.1.3). */
  readonly row: BoxRenderable
  /** The line's content box (flexGrow 1 in 2.1.3). */
  readonly content: BoxRenderable
}

function rowAfterTextarea(node: Renderable, depth: number): MetadataRow | undefined {
  const children = node.getChildren()
  const index = children.findIndex((child) => child instanceof TextareaRenderable)
  if (index >= 0) {
    const row = children[index + 1]
    const content = row?.getChildren()[0]
    return row instanceof BoxRenderable && content instanceof BoxRenderable ? { row, content } : undefined
  }
  if (depth <= 0) return undefined
  for (const child of children) {
    const found = rowAfterTextarea(child, depth - 1)
    if (found) return found
  }
  return undefined
}

/** From a node mounted in the prompt footer, finds the same prompt's metadata row (the box after its textarea). */
export function findMetadataRow(anchor: Renderable | undefined): MetadataRow | undefined {
  let node: Renderable | null = anchor?.parent ?? null
  for (let level = 0; node && level < 3; level++, node = node.parent) {
    const root: Renderable | null = node.parent
    if (!root) return undefined
    const siblings = root.getChildren()
    const index = siblings.indexOf(node)
    for (const sibling of siblings.slice(0, Math.max(0, index))) {
      const found = rowAfterTextarea(sibling, 3)
      if (found) return found
    }
  }
  return undefined
}

/** Adds the role text to the metadata row, right after the effort; returns updater and cleanup. */
export function attachInline(found: MetadataRow, ctx: RenderContext, onClick?: () => void) {
  const node = new TextRenderable(ctx, {
    id: "opencode-roles.inline",
    wrapMode: "none",
    flexShrink: 0,
    onMouseUp: () => onClick?.(),
  })
  const grow = found.content.getFlexGrow()
  // Let the line's content take its natural width so the role follows the effort instead of being
  // pushed to the far right; it still shrinks (and truncates the model) when space is short.
  found.content.flexGrow = 0
  found.row.justifyContent = "flex-start"
  found.row.add(node)
  return {
    node,
    set(content: StyledText) {
      if (!node.isDestroyed) node.content = content
    },
    dispose() {
      if (!found.row.isDestroyed) {
        found.row.remove(node)
        found.row.justifyContent = "space-between"
      }
      if (!found.content.isDestroyed) found.content.flexGrow = grow
      if (!node.isDestroyed) node.destroy()
    },
  }
}

export function RoleIndicator(props: {
  readonly name: () => string | undefined
  readonly theme: ResolvedTheme
  readonly onClick?: () => void
  /** false: always use the footer fallback (tests). */
  readonly inline?: boolean
  readonly retryMs?: number
}) {
  const renderer = useRenderer()
  const [placement, setPlacement] = createSignal<"pending" | "inline" | "footer">(
    props.inline === false ? "footer" : "pending",
  )
  let anchor: BoxRenderable | undefined
  let attached: ReturnType<typeof attachInline> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  onMount(() => {
    if (props.inline === false) return
    let tries = 0
    const tick = () => {
      if (disposed || attached) return
      const found = findMetadataRow(anchor)
      if (found) {
        attached = attachInline(found, renderer, props.onClick)
        attached.set(inlineContent(props.name(), props.theme))
        setPlacement("inline")
        renderer.requestRender()
        return
      }
      if (++tries < 30) timer = setTimeout(tick, props.retryMs ?? 100)
      else setPlacement("footer")
    }
    tick()
  })
  createEffect(() => {
    const content = inlineContent(props.name(), props.theme)
    if (placement() === "inline") {
      attached?.set(content)
      renderer.requestRender()
    }
  })
  onCleanup(() => {
    disposed = true
    clearTimeout(timer)
    attached?.dispose()
  })

  const colors = () => roleColors(props.theme)
  return (
    <box
      ref={(renderable: BoxRenderable) => {
        anchor = renderable
      }}
      visible={placement() === "footer"}
      flexShrink={0}
      onMouseUp={() => props.onClick?.()}
    >
      <Show
        when={props.name()}
        fallback={
          <text fg={colors().idle} wrapMode="none">
            {roleLabel(undefined)}
          </text>
        }
      >
        <text wrapMode="none">
          <b style={{ fg: colors().label }}>Role:</b> <b style={{ fg: colors().active }}>{props.name()}</b>
        </text>
      </Show>
    </box>
  )
}
