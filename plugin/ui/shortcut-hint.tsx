/** @jsxImportSource @opentui/solid */
// "alt+r roles" in the prompt footer, after OpenCode's own "tab agents" and "ctrl+p commands" and in
// their style: the key in base text, the word muted. It uses the documented `prompt.footer` slot, not
// the host layout, so it survives OpenCode updates.
import type { ResolvedTheme } from "@opencode/theme/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { Show } from "solid-js"

/** Narrower terminals leave the hint out, so OpenCode's own hints and usage keep their room. */
export const HINT_MIN_WIDTH = 100

export function ShortcutHint(props: {
  /** The shortcut as the host formats it ("alt+r"), or undefined when unbound. */
  readonly shortcut: () => string | undefined
  /** The prompt footer's own conditions: normal mode with details shown. */
  readonly visible: boolean
  readonly theme: ResolvedTheme
}) {
  const dimensions = useTerminalDimensions()
  return (
    <Show when={props.visible && dimensions().width >= HINT_MIN_WIDTH && props.shortcut()}>
      <text wrapMode="none" flexShrink={0} fg={props.theme.text.base}>
        {props.shortcut()} <span style={{ fg: props.theme.text.muted }}>roles</span>
      </text>
    </Show>
  )
}
