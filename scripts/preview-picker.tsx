/** @jsxImportSource @opentui/solid */
// Prints a headless frame of the picker with the real catalog: bun scripts/preview-picker.tsx [query] [downPresses]
import { testRender } from "@opentui/solid"
import { discoverRoles } from "../plugin/src/discovery.ts"
import { buildPickerItems } from "../plugin/src/picker-model.ts"
import { RolePicker } from "../plugin/ui/picker.tsx"
import { fakeKeymap, testTheme } from "../test/tui-helpers.ts"

const catalog = await discoverRoles({ directory: process.cwd() })
const keys = fakeKeymap()
const setup = await testRender(
  () => (
    <RolePicker title="Role for this session" items={buildPickerItems(catalog.roles)} current="default" activeLabel="default (no role)"
      theme={testTheme} layer={keys.layer} onPick={() => {}} onCancel={() => {}} enterGuardMs={0} />
  ),
  { width: 88, height: 40 },
)
await setup.renderOnce()
await Bun.sleep(5)
if (process.argv[2]) await setup.mockInput.typeText(process.argv[2])
for (let i = 0; i < Number(process.argv[3] ?? 0); i++) keys.press("down")
await setup.renderOnce()
await setup.renderOnce()
console.log(setup.captureCharFrame().split("\n").map((l) => l.trimEnd()).filter((l, i, a) => l || a[i - 1]).join("\n"))
setup.renderer.destroy()
