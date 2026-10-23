import type { KeymapLayer } from "@opencode/plugin/tui/context"
import { RGBA } from "@opentui/core"

export const hex = (value: string) => RGBA.fromHex(value)

/** Minimal dialog-surface theme with the tokens the components read. */
export const testTheme = {
  text: {
    base: hex("#eeeeee"),
    muted: hex("#999999"),
    faint: hex("#666666"),
    formfield: { focused: hex("#ffffff") },
    feedback: { warning: { base: hex("#ffaa00") } },
  },
  background: { formfield: { focused: hex("#222222") } },
  hue: { accent: { 200: hex("#ff8800") } },
} as never

/** Fake host keymap: records layers; `press` runs the command bound to a key, like OpenCode's keymap. */
export function fakeKeymap() {
  const layers: (() => KeymapLayer)[] = []
  const all = () => layers.flatMap((factory) => factory().commands ?? [])
  return {
    layers,
    layer: (factory: () => KeymapLayer) => {
      layers.push(factory)
    },
    shortcuts: (id: string) => all().flatMap((command) => (command.id === id && typeof command.bind === "string" ? command.bind.split(",") : [])),
    press(key: string) {
      for (const factory of [...layers].reverse())
        for (const command of factory().commands ?? [])
          if (typeof command.bind === "string" && command.bind.split(",").includes(key)) return void command.run()
      throw new Error(`no binding for ${key}`)
    },
  }
}
