// OpenCode V2 adapter.
//
// OpenCode V2 does not run V1 plugins (`export const X: Plugin = async () =>
// ({ tool: {...} })`). This module wraps the V1 tool definition from
// ./mystatus and registers it through the V2 tool API, so one build serves
// both. Install it by re-exporting the built file from a local plugin:
//
//   // ~/.config/opencode/plugins/mystatus/index.ts
//   export { default } from "/absolute/path/to/opencode-mystatus/dist/plugin/opencode-v2.js";
//
// The V2 plugin API is not published as types, hence the loose `any`s.
import { MyStatusPlugin } from "./mystatus.js";

const input = {
  type: "object",
  properties: {
    format: { type: "string", enum: ["ansi", "json"] },
    threshold: { type: "number" },
    width: { type: "number" },
    layout: { type: "string", enum: ["auto", "single", "double"] },
    sort: { type: "string", enum: ["urgency", "name", "reset"] },
    summary: { type: "boolean" },
    trend: { type: "string", enum: ["off", "compact", "full"] },
    only: { type: "string" },
    exclude: { type: "string" },
    fresh: { type: "boolean" },
  },
  additionalProperties: false,
};

export default {
  id: "mystatus",
  async setup(ctx: any) {
    const v1 = await MyStatusPlugin({} as any);
    const mystatus = v1.tool!.mystatus;

    await ctx.tool.transform((editor: any) => {
      editor.add({
        name: "mystatus",
        description: mystatus.description,
        input,
        execute: async (args: Record<string, unknown>) => {
          const result: unknown = await mystatus.execute(args as any, {} as any);
          return {
            content: typeof result === "string" ? result : (result as { output: string }).output,
          };
        },
      });
    });
  },
};
