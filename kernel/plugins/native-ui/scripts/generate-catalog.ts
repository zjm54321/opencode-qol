// SPDX-License-Identifier: GPL-3.0-or-later
import { isReactiveSchema } from "@openuidev/lang-core";
import { library, librarySchema, limits } from "../src/library.ts";

export function catalogManifest() {
  return {
    formatVersion: 1,
    langCoreVersion: "1.1.0",
    library: library.id,
    root: library.root,
    limits,
    definitions: librarySchema.$defs,
    components: Object.fromEntries(Object.entries(library.components).map(([name, component]) => {
      const schema = librarySchema.$defs![name]!;
      return [name, { props: Object.entries(component.props.shape).map(([key, prop]) => ({ name: key, required: schema.required?.includes(key) ?? false, reactive: isReactiveSchema(prop), type: schema.properties![key] })) }];
    })),
  };
}

if (import.meta.main) {
  const json = JSON.stringify(catalogManifest(), null, 2) + "\n";
  const output = new URL("../catalog.json", import.meta.url);
  if (process.argv.includes("--check")) {
    if (await Bun.file(output).text() !== json) throw new Error("catalog.json is stale; run generate-catalog.ts");
  } else await Bun.write(output, json);
  console.log(`${output.pathname}: ${Object.keys(library.components).length} components`);
}
