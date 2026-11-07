// SPDX-License-Identifier: GPL-3.0-or-later
import { Plugin } from "@opencode/plugin";
import { z } from "zod/v4";
import { limits } from "./library.ts";
import { description } from "./prompt.ts";
import { failureText, validateSource } from "./validate.ts";

export default Plugin.define({
  id: "opencode.qol.native-ui",
  async setup(ctx) {
    const tools = await ctx.tool.transform(editor => editor.add({
      name: "native_ui",
      options: { codemode: false, permission: "native_ui" },
      description,
      input: z.object({ source: z.string().max(limits.sourceLength), title: z.string().max(120).optional() }),
      async execute(input, execution) {
        execution.signal.throwIfAborted();
        const validation = validateSource(input.source);
        // Rejecting makes the actual session.tool.failed event, not a successful tool with an error-looking string.
        if (!validation.ok) throw new Error(failureText(validation.errors));
        return { content: "Native interactive card validated and ready.", metadata: { nativeUi: { version: 1, catalog: "fluentcode-native-ui@0.1.0", title: input.title, statements: validation.result.meta.statementCount } } };
      },
    }));
    const agents = await ctx.agent.transform(editor => {
      for (const agent of editor.list()) if (agent.mode !== "primary") editor.update(agent.id, current => {
        current.permissions.push({ action: "native_ui", resource: "*", effect: "deny" });
      });
    });
    return async () => { await agents.dispose(); await tools.dispose(); };
  },
});
