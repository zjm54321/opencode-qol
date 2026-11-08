// SPDX-License-Identifier: GPL-3.0-or-later
import { library, librarySchema, limits } from "../src/library.ts";
import { componentReference, examples } from "../src/reference.ts";
import { failureText, validateSource } from "../src/validate.ts";

export function skillReference(): string {
  const names = Object.keys(library.components);
  const shared = Object.entries(librarySchema.$defs!).filter(([name]) => !library.components[name]);
  return [
    "# Native component catalog",
    "",
    "<!-- Generated from components.ts, library.ts and reference.ts. Do not edit by hand. -->",
    "Regenerate with `bun kernel/plugins/native-ui/scripts/generate-skill-reference.ts`; use `--check` to detect drift.",
    "",
    `Library: \`${library.id}\`. All ${names.length} components below use positional arguments in the listed order. \`?\` marks an optional prop; use \`null\` to skip it. Bind a **reactive** prop to a \`$variable\` (or an inline assignment using \`$value\`). Other props can read expressions and update when state changes.`,
    "",
    `Limits: ${limits.sourceLength} source characters, ${limits.stringLength} characters per string, ${limits.nodes} nodes, depth ${limits.depth}.`,
    "",
    "## Contents",
    "",
    "- [Shared types](#shared-types)",
    ...names.map(name => `- [${name}](#${name.toLowerCase()})`),
    "",
    "## Shared types",
    "",
    "The prop schemas below are generated JSON Schema, including enum values, bounds and array/object shapes. A Node is a native component or expression. Color strings should use native theme tokens. ActionExpression slots accept syntax calls, not the legacy data-object shapes in the upstream schema: use `@Set`, `@Reset`, `@ToAssistant`, `@OpenUrl` or `Action([...])`; see [the language guide](language.md).",
    "",
    ...shared.map(([name, schema]) => `- \`${name}\`: \`${JSON.stringify(schema)}\``),
    "",
    componentReference(names),
    "",
  ].join("\n");
}

if (import.meta.main) {
  for (const name of Object.keys(library.components)) {
    if (!examples[name]) throw new Error(`Missing component reference example: ${name}`);
    const checked = validateSource(examples[name]);
    if (!checked.ok) throw new Error(`${name}: ${failureText(checked.errors)}`);
  }
  const markdown = skillReference();
  const output = new URL("../../../defaults/skills/native-ui/references/components.md", import.meta.url);
  if (process.argv.includes("--check")) {
    if (await Bun.file(output).text() !== markdown) throw new Error("native-ui/references/components.md is stale; run generate-skill-reference.ts");
  } else await Bun.write(output, markdown);
  console.log(`${output.pathname}: ${Object.keys(library.components).length} components`);
}
