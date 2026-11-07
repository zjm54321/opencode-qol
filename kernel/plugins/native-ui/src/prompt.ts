// SPDX-License-Identifier: GPL-3.0-or-later
import { generateSystemPrompt } from "@openuidev/lang-core";
import { library } from "./library.ts";

export const description = generateSystemPrompt({
  library: library.toSpec(),
  promptOptions: {
    bindings: true,
    builtinFunctions: false,
    toolCalls: false,
    preamble: "native_ui(source, title?): show a native interactive card in FluentCode. Use for calculators, visual comparisons, option pickers and forms that change displayed results. For charts, wait until a chart component exists. Do not use for ordinary prose, code edits, terminal work, or decorative cards. Put the OpenUI Lang program in source, not in a chat fence.",
    additionalRules: [
      "Available pure functions: @Count(array), @Sum(numbers), @Round(number, decimals?), @Each(array, item, inlineTemplate). Every input must affect the card or a short @ToAssistant message.",
      "Use only the listed components and native theme color tokens. Gap/padding are 4px steps. No HTML, scripts, file/network access, images or external resources. @OpenUrl is disabled in this slice; all URL data must be absolute http(s).",
      "Query, Mutation and @Run are phase 2: parsed defaults only, marked 未支持; do not generate them for a working card. Actions must be written as @Set, @Reset, @ToAssistant or Action([...]), never constructed as data objects.",
      "Limits: source 65536 characters, strings 16384 characters, 4096 nodes, depth 64. On validation failure fix the reported line/column and call native_ui again. Success returns only a short acknowledgement.",
    ],
    examples: ['\u0024n = 2\nroot = Col([Card([Slider(\u0024n, 1, 10, 1, "Quantity"), Text("Total: " + \u0024n * 12), Button("Ask", @ToAssistant("Help with quantity " + \u0024n))])])'],
  },
});
