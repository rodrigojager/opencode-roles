/** @jsxImportSource @opentui/solid */
// Role picker: a port of Pi's AgentPicker "cards" layout (pi-agent-switcher picker.ts) to OpenTUI.
import type { KeymapLayer } from "@opencode/plugin/tui/context"
import type { ResolvedTheme } from "@opencode/theme/tui"
import { type BoxRenderable, type InputRenderable, type MouseEvent, TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, Index, Show } from "solid-js"
import {
  filterPickerItems,
  fitCardTitle,
  maxVisibleCards,
  moveSelection,
  type PickerItem,
  resultSummary,
  selectionFor,
  truncateEnd,
  visibleWindow,
} from "../src/picker-model.ts"

const ACTIVE_BADGE = " · active"
const DESCRIPTION_INDENT = "    "

export interface RolePickerProps {
  readonly title: string
  readonly items: readonly PickerItem[]
  /** Value of the active entry ("default" when no role is active). */
  readonly current: string
  readonly activeLabel: string
  readonly initialQuery?: string
  /** Footer verb for Enter, e.g. "select" or "preview". */
  readonly submitLabel?: string
  readonly note?: string
  readonly theme: ResolvedTheme
  readonly layer: (factory: () => KeymapLayer) => void
  readonly onPick: (value: string) => void
  readonly onCancel: () => void
  /** Ignore an Enter that arrives this soon after opening (the keypress that ran the command). */
  readonly enterGuardMs?: number
  readonly autoFocus?: boolean
}

export function RolePicker(props: RolePickerProps) {
  const dimensions = useTerminalDimensions()
  const theme = props.theme
  const [query, setQuery] = createSignal(props.initialQuery ?? "")
  const matches = createMemo(() => filterPickerItems(props.items, query()))
  const [selected, setSelected] = createSignal(selectionFor(matches(), query(), props.current))
  const maxVisible = createMemo(() => maxVisibleCards(dimensions().height))
  const range = createMemo(() => visibleWindow(matches().length, selected(), maxVisible()))
  const visible = createMemo(() => {
    const { start, end } = range()
    return matches()
      .slice(start, end)
      .map((item, offset) => ({ item, index: start + offset }))
  })
  const accent = () => theme.hue.accent[200]
  // Card text width: measured from the list box; estimated from the terminal until the first layout.
  const [measured, setMeasured] = createSignal(0)
  const width = () => measured() || Math.max(10, Math.min(88, dimensions().width - 2) - 6)
  const openedAt = Date.now()
  let finished = false
  let pressed: string | undefined

  const pick = (value: string) => {
    if (finished) return
    finished = true
    props.onPick(value)
  }
  const submit = () => {
    if (Date.now() - openedAt < (props.enterGuardMs ?? 150)) return
    const item = matches()[selected()]
    if (item) pick(item.value)
  }
  const move = (delta: number) => setSelected((index) => moveSelection(index, delta, matches().length))
  const onQuery = (value: string) => {
    setQuery(value)
    setSelected(selectionFor(filterPickerItems(props.items, value), value, props.current))
  }

  props.layer(() => ({
    mode: "modal",
    commands: [
      { bind: "up,ctrl+p", title: "Previous role", group: "Roles", run: () => move(-1) },
      { bind: "down,ctrl+n", title: "Next role", group: "Roles", run: () => move(1) },
      { bind: "pageup", title: "Previous page", group: "Roles", run: () => move(-maxVisible()) },
      { bind: "pagedown", title: "Next page", group: "Roles", run: () => move(maxVisible()) },
      { bind: "return", title: "Pick role", group: "Roles", run: submit },
    ],
  }))

  let input: InputRenderable | undefined
  return (
    <box flexDirection="column" paddingLeft={3} paddingRight={3} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
          {props.title}
        </text>
        <text fg={theme.text.muted} flexShrink={0} onMouseUp={() => props.onCancel()}>
          esc
        </text>
      </box>
      <text fg={theme.text.muted} wrapMode="none" truncate>
        {"Active: "}
        <span style={{ fg: theme.text.base }}>{props.activeLabel}</span>
      </text>
      <box flexDirection="row" paddingTop={1}>
        <text fg={theme.text.muted} flexShrink={0}>
          {"Search: "}
        </text>
        <input
          flexGrow={1}
          value={props.initialQuery ?? ""}
          placeholder="Name, ID, category or description"
          placeholderColor={theme.text.muted}
          focusedBackgroundColor={theme.background.formfield.focused}
          focusedTextColor={theme.text.formfield.focused}
          cursorColor={theme.text.formfield.focused}
          onInput={(value: string) => onQuery(value)}
          ref={(renderable: InputRenderable) => {
            input = renderable
            if (props.autoFocus === false) return
            setTimeout(() => {
              if (input && !input.isDestroyed) input.focus()
            }, 1)
          }}
        />
      </box>
      <box
        flexDirection="column"
        paddingTop={1}
        onSizeChange={function (this: BoxRenderable) {
          const next = this.width
          queueMicrotask(() => setMeasured(next))
        }}
        onMouseScroll={(event: MouseEvent) => {
          const direction = event.scroll?.direction
          if (direction === "up") move(-1)
          else if (direction === "down") move(1)
        }}
      >
        <Index each={visible()}>
          {(entry) => {
            const isSelected = () => entry().index === selected()
            const item = () => entry().item
            const isActive = () => item().value === props.current
            const title = createMemo(() =>
              fitCardTitle(item().name, item().category, isActive() ? ACTIVE_BADGE : "", width()),
            )
            return (
              <box
                flexDirection="column"
                marginTop={entry().index > range().start ? 1 : 0}
                onMouseDown={() => {
                  pressed = item().value
                }}
                onMouseUp={() => {
                  // Only a press and release on the same card picks it (the window never moves under the mouse).
                  if (pressed === item().value) pick(item().value)
                  pressed = undefined
                }}
              >
                <text wrapMode="none" fg={theme.text.base}>
                  <span style={{ fg: isSelected() ? accent() : theme.text.muted }}>{isSelected() ? "› " : "  "}</span>
                  <b style={{ fg: isSelected() ? accent() : theme.text.base }}>{title().name}</b>
                  <Show when={title().category}>
                    <span style={{ fg: theme.text.muted }}>{title().category}</span>
                  </Show>
                  <Show when={isActive()}>
                    <span style={{ fg: theme.text.faint }}>{ACTIVE_BADGE}</span>
                  </Show>
                </text>
                <text wrapMode="none" fg={isSelected() ? theme.text.base : theme.text.muted}>
                  {DESCRIPTION_INDENT + (truncateEnd(item().description, width() - DESCRIPTION_INDENT.length) || " ")}
                </text>
              </box>
            )
          }}
        </Index>
        <Show when={matches().length === 0}>
          <text fg={theme.text.feedback.warning.base}>No matching roles</text>
        </Show>
      </box>
      <box paddingTop={1} flexDirection="column">
        <Show when={props.note}>
          <text fg={theme.text.faint} wrapMode="none" truncate>
            {props.note}
          </text>
        </Show>
        <text fg={theme.text.muted} wrapMode="none" truncate>
          {`${resultSummary(matches().length)}${matches().length ? ` · ${selected() + 1}/${matches().length}` : ""} · ↑↓ navigate · Enter ${props.submitLabel ?? "select"} · Esc cancel`}
        </text>
      </box>
    </box>
  )
}
