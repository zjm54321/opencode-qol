import { describe, expect, mock, test } from "bun:test";
import { createParser, createStreamingParser } from "@openuidev/lang-core";
import { library, librarySchema, limits } from "../plugins/native-ui/src/library.ts";
import { description } from "../plugins/native-ui/src/prompt.ts";
import { componentReference, examples } from "../plugins/native-ui/src/reference.ts";
import { failureText, validateSource } from "../plugins/native-ui/src/validate.ts";
import { catalogManifest } from "../plugins/native-ui/scripts/generate-catalog.ts";
import { skillReference } from "../plugins/native-ui/scripts/generate-skill-reference.ts";

const skillRoot = new URL("../defaults/skills/native-ui/", import.meta.url);

mock.module("@opencode/plugin", () => ({ Plugin: { define: (definition: unknown) => definition } }));
const { default: plugin } = await import("../plugins/native-ui/src/index.ts");

describe("native_ui official parser validation", () => {
  test.each([
    'root = Card([Title("Hello"), Text("Native controls"), Divider(), Caption("Ready"), Badge("OK")])',
    '$n = 2\nroot = Col([Slider($n, 1, 10, 1, "Quantity"), Text("Total: " + @Round($n * 12, 2)), Button("Add", @Set($n, $n + 1))])',
    '$choice = "fast"\nroot = Card([Select($choice, [{value:"fast",label:"Fast"}, "Safe"], "Plan"), Button("Ask", @ToAssistant("I choose " + $choice))])',
    '$done = false\nroot = Col([Input("", "Name"), Checkbox($done, "Done"), Markdown("**Native** prose"), Button("Reset", @Reset($done))])',
    'root = Card([later])\nlater = Text("Forward reference")',
    '$items = [1,2,3]\nroot = Col([@Each($items, item, Text("Item " + item)), Text("Sum: " + @Sum($items))])',
    '$small = false\nroot = $small ? Card([Text("Small")]) : Card([Text("Large")])',
    'q = Query("future", {}, {price:12})\nroot = Card([Text("Price: " + q.price), Button("Refresh", @Run(q))])',
  ])("accepts valid OpenUI Lang %#", source => expect(validateSource(source).ok).toBe(true));

  test.each([
    ['root = HtmlView("<script/>")', "unknown-component"],
    ['root = Text(42)', "type-mismatch"],
    ['root = Title()', "missing-required"],
    ['root = Title(null)', "null-required"],
    ['root = Card([missing])', "unresolved"],
    ['root = Card([loop])\nloop = loop', "unresolved"],
    ['root = Card([Text("Cut"', "incomplete"],
    ['root = Card([Text("Hi")])\nthis is not a statement', "syntax"],
    ['root = Text("Hi", null, null, null, false, false, false, 1, 2)', "excess-args"],
    ['root = Card([Text(@Missing(1))])', "unknown-function"],
    ['root = Input(false)', "type-mismatch"],
    ['root = Card([Button("Bad", {type:"continue_conversation",context:"oops"})])', "action"],
    ['root = Image("http://example.org/photo.png", "Photo")', "url"],
    ['root = Text("file:///etc/passwd")', "url"],
    ['root = Text("javascript:alert(1)")', "url"],
    ['root = Markdown("![image](file:///etc/passwd)")', "url"],
    ['root = Markdown("[bad](javascript:alert(1))")', "url"],
    ['root = 42', "no-root"],
    ['', "parse-failed"],
  ])("rejects invalid OpenUI Lang %#", (source, code) => {
    const checked = validateSource(source);
    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(checked.errors.some(error => error.code === code)).toBe(true);
      expect(checked.errors.every(error => error.line >= 1 && error.column >= 1)).toBe(true);
      expect(failureText(checked.errors)).toContain("Fix and retry");
    }
  });

  test("reports the actual argument's line and column", () => {
    const checked = validateSource('root = Card([label])\nlabel = Title(\n  42\n)');
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.errors[0]).toMatchObject({ line: 3, column: 3, code: "type-mismatch" });
  });
  test("locations distinguish repeated inline components and ignore reference names inside strings", () => {
    const checked = validateSource('root = Card([Text("good"),\n  Text(42), Text(43)])');
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.errors.map(error => [error.line, error.column])).toEqual([[2, 8], [2, 18]]);
    const unresolved = validateSource('root = Card([Text("missing"),\n  missing])');
    expect(unresolved.ok).toBe(false);
    if (!unresolved.ok) expect(unresolved.errors.find(error => error.code === "unresolved")).toMatchObject({ line: 2, column: 3 });
  });
  test("bounds strings, bracket depth, unary depth and expanded reference DAGs", () => {
    for (const source of [
      'root = Text("' + "x".repeat(limits.stringLength + 1) + '")',
      'root = Text(' + "(".repeat(limits.depth + 1) + '1' + ")".repeat(limits.depth + 1) + ')',
      'root = Text(' + "!".repeat(limits.depth + 1) + 'true)',
      'root = Card([n0])\n' + Array.from({ length: 16 }, (_, i) => `n${i} = Card([n${i + 1},n${i + 1}])`).join("\n") + '\nn16 = Text("leaf")',
      'root = Col([' + Array.from({ length: limits.nodes }, () => 'Text("x")').join(",") + '])',
    ]) {
      const checked = validateSource(source);
      expect(checked.ok).toBe(false);
      if (!checked.ok) expect(checked.errors.some(error => error.code === "limit")).toBe(true);
    }
  });
  test("streaming official parser finishes with the same tree as a full parse", () => {
    const source = '$n = 1\nroot = Col([Text("n=" + $n), Button("+", @Set($n, $n + 1))])';
    const stream = createStreamingParser(librarySchema, library.root);
    for (const chunk of source.match(/.{1,7}|\n/g) ?? []) stream.push(chunk);
    expect(stream.getResult(true)).toEqual(createParser(librarySchema, library.root).parse(source));
  });
  test("manifest preserves the ordered catalog and the lean tool description routes to the skill", async () => {
    expect(await Bun.file(new URL("../plugins/native-ui/catalog.json", import.meta.url)).json()).toEqual(catalogManifest());
    expect(catalogManifest().components.Slider.props.map(prop => prop.name)).toEqual(["value", "min", "max", "step", "label", "unit", "marks"]);
    expect(catalogManifest().components.Input.props[0].reactive).toBe(true);
    expect(description).toContain("@ToAssistant");
    expect(description).toContain("ordinary prose");
    expect(description).toContain("未支持");
    expect(description).toContain("Load the native-ui skill before your first native_ui call");
    expect(description.length).toBeLessThan(2_000);
  });
  test("FluentCode embeds a byte-identical catalog and all demos validate on the server", async () => {
    const fluent = process.env.NUI_FLUENTCODE_ROOT ?? "/mnt/c/src/fluentcode-lanes/native-ui-v1";
    expect(await Bun.file(`${fluent}/src/FluentCode/Services/NativeUi/catalog.json`).text()).toBe(await Bun.file(new URL("../plugins/native-ui/catalog.json", import.meta.url)).text());
    for (const name of new Bun.Glob("demo-*.oui").scanSync(`${fluent}/tests/native-ui/fixtures`)) {
      const checked = validateSource(await Bun.file(`${fluent}/tests/native-ui/fixtures/${name}`).text());
      expect(checked).toMatchObject({ ok: true });
    }
  });
  test("conditional action expressions are valid, malformed JSON escapes are not", () => {
    expect(validateSource('$n = 0\nroot = Button("Toggle", $n == 0 ? @Set($n, 1) : @Reset($n))').ok).toBe(true);
    expect(validateSource('root = Text("bad\\q")').ok).toBe(false);
  });
  test("full catalog reference examples validate and expose complete positional docs", () => {
    expect(Object.keys(library.components)).toHaveLength(57);
    expect(library.components.HtmlView).toBeUndefined();
    for (const name of Object.keys(library.components)) {
      expect(examples[name]).toBeDefined();
      expect(validateSource(examples[name]!)).toMatchObject({ ok: true });
      expect(componentReference([name])).toContain("Props in positional order:");
      expect(componentReference([name])).toContain(examples[name]!);
    }
    expect(() => componentReference(["HtmlView"])).toThrow("Unknown native component");
    expect(validateSource('root = Button("Open", @OpenUrl("https://example.org"))').ok).toBe(true);
    expect(failureText([])).toContain("load the native-ui skill");
    expect(failureText([])).toContain("references/error-recovery.md");
  });
  test("button sizing is selectable and the generated reference explains adaptive keypads", () => {
    for (const size of ["sm", "md", "lg"]) {
      expect(validateSource(`root = Button("Key", null, "soft", null, "${size}")`).ok).toBe(true);
      expect(validateSource(`root = IconButton("plus", null, "Add", "outline", "${size}")`).ok).toBe(true);
    }
    expect(componentReference(["Button", "IconButton"])).toContain("sm=32px, md=40px, lg=48px");
    expect(componentReference(["Button"])).toContain("0.8× column width, clamped to 40–56px");
    expect(catalogManifest().components.IconButton.props.map(prop => prop.name)).toEqual(["icon", "action", "label", "variant", "size"]);
  });
  test("map coordinates and native media URLs remain bounded and explicitly loaded", () => {
    for (const source of ['root = Video("https://example.org/v.mp4", "Video", 300)', 'root = Audio("https://example.org/a.mp3", "Audio")', 'root = ImageGallery([{src:"https://example.org/a.png",alt:"A"}], "Gallery", 320)', 'root = Map([MapMarker("Beijing",39.908823,116.39747)], true)']) expect(validateSource(source).ok).toBe(true);
    for (const source of ['root = Video("http://example.org/v.mp4")', 'root = Audio("https://user:secret@example.org/a.mp3")', 'root = ImageGallery([])', 'root = ImageGallery([{src:"http://example.org/a.png"}])', 'root = MapMarker("Invalid",91,181)']) expect(validateSource(source).ok).toBe(false);
    expect(componentReference(["Map", "MapMarker"])).toContain("WGS-84");
    expect(componentReference(["Video", "Audio", "ImageGallery"])).toContain("HTTPS");
    expect(componentReference(["YouTube"])).toContain("in-app browser");
  });

  test("the shipped skill catalog is generated from all 57 validator schemas without drift", async () => {
    const reference = await Bun.file(new URL("references/components.md", skillRoot)).text();
    expect(reference).toBe(skillReference());
    expect(Object.keys(examples).sort()).toEqual(Object.keys(library.components).sort());
    expect([...reference.matchAll(/^## (\w+)$/gm)].map(match => match[1]).filter(name => library.components[name])).toEqual(Object.keys(library.components));
    for (const [name, component] of Object.entries(catalogManifest().components)) {
      const section = reference.split(`## ${name}\n`)[1]!.split("\n## ")[0]!;
      expect(section).toContain(`${name}(${component.props.map(prop => prop.name).join(", ")})`);
      for (const prop of component.props) expect(section).toContain(`- \`${prop.name}${prop.required ? "" : "?"}\`${prop.reactive ? " **reactive**" : ""}: \`${JSON.stringify(prop.type)}\``);
    }
  });

  test("every fenced example in every skill document passes the real native UI validator", async () => {
    const files = [...new Bun.Glob("**/*.md").scanSync(skillRoot.pathname)].sort();
    const programs: { file: string; source: string }[] = [];
    for (const file of files) {
      const markdown = await Bun.file(new URL(file, skillRoot)).text();
      for (const match of markdown.matchAll(/```([^\n]*)\n([\s\S]*?)```/g)) {
        expect(match[1]).toBe("openui");
        programs.push({ file, source: match[2]!.trim() });
      }
    }
    expect(files).toHaveLength(6);
    expect(programs).toHaveLength(Object.keys(library.components).length + 11);
    for (const { file, source } of programs) expect({ file, source, ...validateSource(source) }).toMatchObject({ ok: true });
  });

  test("the skill entrypoint declares the FluentCode tool requirement and links all manuals", async () => {
    const markdown = await Bun.file(new URL("SKILL.md", skillRoot)).text();
    expect(markdown).toMatch(/^---\nname: native-ui\ndescription: .*FluentCode.*native_ui/m);
    expect(markdown).toContain("before the first native_ui call");
    expect(markdown).toContain("not for plain answers, code or unsolicited UI");
    expect(markdown).toContain("normal composer");
    const links = [...markdown.matchAll(/\]\((references\/[^)]+\.md)\)/g)].map(match => match[1]!);
    expect(links.sort()).toEqual(["references/behavior-and-design.md", "references/components.md", "references/error-recovery.md", "references/examples.md", "references/language.md"]);
    for (const link of links) expect(await Bun.file(new URL(link, skillRoot)).exists()).toBe(true);
  });
});

test("tool registration fails bad input, avoids echoing data, restricts non-primary agents and disposes", async () => {
  const registrations: any[] = [];
  let toolDisposed = 0, agentDisposed = 0;
  const agents = [
    { id: "main", mode: "primary", permissions: [] as unknown[] },
    { id: "fixer", mode: "subagent", permissions: [] as unknown[] },
    { id: "both", mode: "all", permissions: [] as unknown[] },
  ];
  const dispose = await plugin.setup({
    tool: { transform: async (callback: any) => { callback({ add: (tool: any) => { registrations.push(tool); } }); return { dispose: async () => { toolDisposed++; } }; } },
    agent: { transform: async (callback: any) => { callback({ list: () => agents, update: (id: string, fn: any) => fn(agents.find(agent => agent.id === id)) }); return { dispose: async () => { agentDisposed++; } }; } },
  } as any);
  const [registered] = registrations;
  expect(registrations.map(tool => tool.name)).toEqual(["native_ui"]);
  expect(registered.name).toBe("native_ui");
  expect(registered.options).toEqual({ codemode: false, permission: "native_ui" });
  const signal = new AbortController().signal;
  await expect(registered.execute({ source: 'root = HtmlView("bad")' }, { signal })).rejects.toThrow("line 1, column");
  const result = await registered.execute({ source: 'root = Text("private large data")', title: "Example" }, { signal });
  expect(result.content).not.toContain("private large data");
  expect(result.content.length).toBeLessThan(100);
  expect(result.metadata.nativeUi.title).toBe("Example");
  expect(agents[0].permissions).toEqual([]);
  for (const agent of agents.slice(1)) expect(agent.permissions).toEqual([{ action: "native_ui", resource: "*", effect: "deny" }, { action: "skill", resource: "native-ui", effect: "deny" }]);
  await dispose();
  expect([toolDisposed, agentDisposed]).toEqual([1, 1]);
});
