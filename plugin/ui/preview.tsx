/** @jsxImportSource @opentui/solid */
// Read-only, scrollable view of a role's text (/role show, and Enter in /roles).
import type { KeymapLayer } from "@opencode/plugin/tui/context"
import type { ResolvedTheme } from "@opencode/theme/tui"
import { type ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo } from "solid-js"

export interface RolePreviewProps {
  readonly title: string
  readonly subtitle?: string
  readonly body: string
  readonly theme: ResolvedTheme
  readonly layer: (factory: () => KeymapLayer) => void
  readonly onClose: () => void
  readonly hint?: string
}

export function RolePreview(props: RolePreviewProps) {
  const dimensions = useTerminalDimensions()
  const theme = props.theme
  const height = createMemo(() => Math.max(5, dimensions().height - 12))
  let scroll: ScrollBoxRenderable | undefined
  const by = (delta: number) => scroll?.scrollBy(delta)
  const page = () => Math.max(1, (scroll?.height ?? height()) - 1)
  props.layer(() => ({
    mode: "modal",
    commands: [
      { bind: "up,k", title: "Scroll up", group: "Roles", run: () => by(-1) },
      { bind: "down,j", title: "Scroll down", group: "Roles", run: () => by(1) },
      { bind: "pageup", title: "Page up", group: "Roles", run: () => by(-page()) },
      { bind: "pagedown,space", title: "Page down", group: "Roles", run: () => by(page()) },
      { bind: "home", title: "Top", group: "Roles", run: () => scroll?.scrollTo(0) },
      { bind: "end", title: "Bottom", group: "Roles", run: () => scroll?.scrollTo(scroll.scrollHeight) },
      { bind: "return", title: "Close", group: "Roles", run: () => props.onClose() },
    ],
  }))
  return (
    <box flexDirection="column" paddingLeft={3} paddingRight={3} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
          {props.title}
        </text>
        <text fg={theme.text.muted} flexShrink={0} onMouseUp={() => props.onClose()}>
          esc
        </text>
      </box>
      <text fg={theme.text.muted} wrapMode="none" truncate>
        {props.subtitle ?? ""}
      </text>
      <box paddingTop={1}>
        <scrollbox
          maxHeight={height()}
          scrollbarOptions={{ visible: true }}
          ref={(renderable: ScrollBoxRenderable) => {
            scroll = renderable
          }}
        >
          <text fg={theme.text.base} wrapMode="word">
            {props.body}
          </text>
        </scrollbox>
      </box>
      <box paddingTop={1}>
        <text fg={theme.text.muted} wrapMode="none" truncate>
          {props.hint ?? "↑↓ / PgUp PgDn scroll · Enter or Esc close"}
        </text>
      </box>
    </box>
  )
}
