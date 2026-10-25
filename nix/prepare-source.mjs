import fs from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"

// Build-time only: operate on the writable Nix build tree and output assets.
const required = (name) => {
  if (!process.env[name]) throw new Error(`Missing build input ${name}`)
  return process.env[name]
}
const source = required("QOL_SOURCE_ROOT")
const assets = required("QOL_ASSET_ROOT")
const output = required("QOL_OUTPUT_ROOT")
const repository = required("QOL_REPOSITORY")
const modules = required("QOL_NODE_MODULES")
const graph = path.join(source, "packages/core/src/plugin/qol")
const ts = createRequire(path.join(source, "package.json"))("typescript")
async function writable(directory) {
  await fs.chmod(directory, (await fs.stat(directory)).mode | 0o200)
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) await writable(file)
    else if (entry.isFile()) await fs.chmod(file, (await fs.stat(file)).mode | 0o200)
  }
}
async function copy(from, to) {
  await fs.cp(from, to, { recursive: true, dereference: true })
  await writable(to)
}

async function replaceOnce(file, before, after) {
  const text = await fs.readFile(file, "utf8")
  if (text.split(before).length !== 2) throw new Error(`Upstream source changed: ${file}: ${before}`)
  await fs.writeFile(file, text.replace(before, after))
}

await fs.mkdir(path.join(assets, "plugins"), { recursive: true })
// importNpmLock.buildNodeModules exposes node_modules below its output root.
await copy(path.join(modules, "node_modules"), path.join(assets, "node_modules"))
await copy(path.join(repository, "vendor"), path.join(assets, "vendor"))
for (const name of ["image", "session-reader", "clear-encrypted", "desktop-bridge"]) {
  await copy(path.join(repository, "plugins", name), path.join(assets, "plugins", name))
}
for (const [name, variable] of [
  ["gpt-taste", "QOL_GPT_TASTE"],
  ["model-policy", "QOL_MODEL_POLICY"],
]) {
  await copy(required(variable), path.join(assets, "plugins", name))
}
await copy(path.join(repository, "defaults"), path.join(assets, "defaults"))
await fs.symlink(required("QOL_BUN"), path.join(assets, "plugins/clear-encrypted/src/bun"))
// npm's ignored postinstall would otherwise select an unpatched GNU ELF (or
// download one on first use). Keep OMO's package lookup, backed by Nix's binary.
const sg = path.join(assets, "node_modules/@ast-grep/cli/sg")
await fs.rm(sg, { force: true })
await fs.symlink(required("QOL_AST_GREP"), sg)

// Patch readable source, never npm release bundles. Upstream loaders still own
// normalization, user/project precedence and environment overrides.
const omo = path.join(assets, "vendor/oh-my-opencode-slim")
const billion = path.join(assets, "vendor/billion-context")
const pinnedSources = JSON.parse(await fs.readFile(path.join(assets, "vendor/sources.json"), "utf8"))
for (const [directory, name] of [[omo, "oh-my-opencode-slim"], [billion, "billion-context"]]) {
  const pkg = JSON.parse(await fs.readFile(path.join(directory, "package.json"), "utf8"))
  if (pkg.version !== pinnedSources[name].version) throw new Error(`Vendored version changed: ${name}`)
  await fs.copyFile(path.join(repository, "defaults", `${name}.json`), path.join(directory, "qol-defaults.json"))
}
const omoLoader = path.join(omo, "src/config/loader.ts")
await replaceOnce(omoLoader, "export function loadPluginConfig(\n",
  'import qolDefaults from "../../qol-defaults.json";\n\nexport function loadPluginConfig(\n')
await replaceOnce(omoLoader,
  "  let config: RawPluginConfig = userConfigPath\n" +
  "    ? (loadPluginConfigFromPath(userConfigPath, options) ?? {})\n    : {};",
  "  let config: RawPluginConfig = mergePluginConfigs(qolDefaults, userConfigPath\n" +
  "    ? (loadPluginConfigFromPath(userConfigPath, options) ?? {})\n    : {});")

const billionLoader = path.join(billion, "src/config.ts")
await replaceOnce(billionLoader, "export function loadConfigFile(): FileConfig {", `
import qolDefaults from "../qol-defaults.json";

function qolConfigDefaults(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  const result = { ...base, ...override };
  for (const key of Object.keys(override)) {
    const previous = base[key];
    const next = override[key];
    if (object(previous) && object(next)) result[key] = qolConfigDefaults(previous, next);
  }
  return result;
}

export function loadConfigFile(): FileConfig {
  return qolConfigDefaults(qolDefaults, qolUserConfigFile() as Record<string, unknown>) as FileConfig;
}

function qolUserConfigFile(): FileConfig {`)
for (const entry of ["src/cli.ts", "src/inline-engine.ts"]) {
  await replaceOnce(path.join(billion, entry), "    ensureConfigTemplate();",
    "    // QoL: baked defaults need no automatically created user config.")
}
await replaceOnce(path.join(billion, "scripts/write-build-info.mjs"),
  "const info = { commit: buildCommit() };",
  `const info = { commit: ${JSON.stringify(pinnedSources["billion-context"].revision)} };`)

// OMO's official V1 factory still uses the legacy identity/schema helper. Import
// only its official ./tool subpath, not the index that re-exports an SDK client.
// Keep type-only legacy imports erased; the live V2 host comes from core.
async function legacyToolOnly(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) { await legacyToolOnly(file); continue }
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue
    const text = await fs.readFile(file, "utf8")
    const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const edits = []
    for (const node of parsed.statements) {
      if (!ts.isImportDeclaration(node) || node.moduleSpecifier.text !== "@opencode-ai/plugin"
        || node.importClause?.isTypeOnly) continue
      const bindings = node.importClause?.namedBindings
      if (!bindings || !ts.isNamedImports(bindings)) throw new Error(`Unexpected legacy SDK import: ${file}`)
      const values = bindings.elements.filter((element) => !element.isTypeOnly)
      if (!values.length) continue
      if (values.some((element) => (element.propertyName ?? element.name).text !== "tool")) {
        throw new Error(`Unexpected legacy SDK value import: ${file}`)
      }
      edits.push([node.moduleSpecifier.getStart(parsed), node.moduleSpecifier.end])
    }
    let updated = text
    for (const [start, end] of edits.reverse()) {
      updated = updated.slice(0, start) + '"@opencode-ai/plugin/tool"' + updated.slice(end)
    }
    if (updated !== text) await fs.writeFile(file, updated)
  }
}
await legacyToolOnly(path.join(omo, "src"))

// Zod's exact versions are independent of host SDK identity. Billion's lazy V1
// schema import must keep its upstream 4.1.8, rather than personal/OMO's 4.6.7.
await copy(path.join(assets, "node_modules/@opencode-qol/bili-zod"), path.join(billion, "node_modules/zod"))

const run = (command, args, cwd) => execFileSync(command, args, {
  cwd, stdio: "inherit", env: process.env,
})
const tsupPackage = JSON.parse(await fs.readFile(path.join(assets, "node_modules/tsup/package.json"), "utf8"))
const tsupBin = typeof tsupPackage.bin === "string" ? tsupPackage.bin : tsupPackage.bin.tsup
const tsupCli = path.join(assets, "node_modules/tsup", tsupBin)
run(required("QOL_BUN"), ["run", "scripts/gen-build-info.ts"], omo)
run(required("QOL_BUN"), ["build", "src/index.ts", "--outfile", "dist/server/index.js",
  "--target", "node", "--format", "esm", "--external", "jsdom", "--external", "jsonc-parser",
  "--external", "@opencode/*", "--external", "effect"], omo)

// Execute the upstream runtime bundlers, not tsc declaration/typecheck steps.
// These two local packages are inlined by Billion's unmodified tsup config;
// stage copies of their built packages instead of relying on npm file: links.
for (const [subdirectory, name] of [["kernel", "acp-kernel"], ["pi-subagents", "billion-context-pi-subagents"]]) {
  const directory = path.join(billion, subdirectory)
  run(process.execPath, [tsupCli], directory)
  const local = path.join(billion, "node_modules", name)
  await fs.mkdir(local, { recursive: true })
  await fs.copyFile(path.join(directory, "package.json"), path.join(local, "package.json"))
  await fs.copyFile(path.join(directory, "LICENSE"), path.join(local, "LICENSE"))
  await copy(path.join(directory, "dist"), path.join(local, "dist"))
}
run(process.execPath, [tsupCli], billion)
run(process.execPath, ["scripts/write-build-info.mjs"], billion)
run(process.execPath, ["scripts/check-dist-import-annotations.mjs"], billion)
run(process.execPath, ["scripts/check-dist-external-zod.mjs"], billion)

// Legacy V1 SDK/Effect are transitive build inputs for the official tool helper,
// never installed host runtimes. It is now bundled; retain no duplicate SDK or
// Effect tree in assets. Final host imports are bound to core below.
async function removeNpmHostCopies(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const child = path.join(directory, entry.name)
    if (entry.name === "node_modules") {
      for (const name of ["@opencode-ai/plugin", "@opencode-ai/sdk", "effect"]) {
        await fs.rm(path.join(child, name), { recursive: true, force: true })
      }
    }
    await removeNpmHostCopies(child)
  }
}
await removeNpmHostCopies(assets)

// Rebase resource lookups before bundling. In particular Billion's native
// server launches ../index.js in a separate Node process; OMO uses createRequire
// and package-relative skill/ast-grep resources.
// The complete dependency/resource tree is retained at these stable output URLs.
async function rebase(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await rebase(file)
    } else if (entry.isFile() && /\.(?:[cm]?js|[cm]?ts)$/.test(entry.name)) {
      const text = await fs.readFile(file, "utf8")
      if (!text.includes("import.meta")) continue
      const installed = path.join(output, path.relative(assets, file))
      // Parse expressions so quoted code, comments, and template text are not
      // corrupted by a lexical search-and-replace inside prebundled packages.
      const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
      const edits = []
      function visit(node) {
        if (ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression)
          && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword) {
          const value = node.name.text === "url" ? pathToFileURL(installed).href
            : ["dir", "dirname"].includes(node.name.text) ? path.dirname(installed) : undefined
          if (value !== undefined) edits.push([node.getStart(parsed), node.end, JSON.stringify(value)])
        }
        ts.forEachChild(node, visit)
      }
      visit(parsed)
      let updated = text
      for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) {
        updated = updated.slice(0, start) + replacement + updated.slice(end)
      }
      if (updated !== text) await fs.writeFile(file, updated)
    }
  }
}
await rebase(assets)
await copy(assets, graph)
await fs.copyFile(path.join(repository, "src/builtin.ts"), path.join(graph, "builtin.ts"))
await fs.copyFile(path.join(repository, "src/native-pty.ts"), path.join(graph, "native-pty.ts"))

// Use the host workspace SDK and Effect identity in the compiled graph, never a
// second npm SDK/Effect instance. Runtime subprocess dependencies stay untouched
// in the separately installed assets tree.
const workspace = new Map()
for (const entry of await fs.readdir(path.join(source, "packages"), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const directory = path.join(source, "packages", entry.name)
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(directory, "package.json"), "utf8"))
    if (pkg.name?.startsWith("@opencode/")) workspace.set(pkg.name, directory)
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
}
const effect = await fs.realpath(path.join(source, "packages/core/node_modules/effect"))
async function bindHostModules(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const child = path.join(directory, entry.name)
    if (entry.name === "node_modules") {
      for (const [name, target] of [...workspace, ["effect", effect]]) {
        const link = path.join(child, name)
        await fs.rm(link, { recursive: true, force: true })
        await fs.mkdir(path.dirname(link), { recursive: true })
        await fs.symlink(target, link)
      }
    }
    await bindHostModules(child)
  }
}
await bindHostModules(graph)

const internal = path.join(source, "packages/core/src/plugin/internal.ts")
await replaceOnce(internal, 'import { WellKnownPlugin } from "../wellknown/plugin.js"',
  'import { WellKnownPlugin } from "../wellknown/plugin.js"\n' +
  'import { QolPlugins } from "./qol/builtin.js"\n' +
  'import { Plugin as NativePtyPlugin } from "./qol/native-pty.js"\n' +
  'import { PersistentPty } from "../persistent-pty.js"')
// Add the same global native service to InternalPlugin's captured requirements;
// the registry node is shared with the host, not a second daemon instance.
await replaceOnce(internal, "  Permission.Service,", "  Permission.Service,\n  PersistentPty.Service,")
await replaceOnce(internal, "  Permission.node,", "  Permission.node,\n  PersistentPty.node,")
await replaceOnce(internal, "post: resolve(post),", "post: [...resolve([...post, NativePtyPlugin]), ...QolPlugins],")

// Embed a real lowest-priority document, leaving user/project/managed config in
// its original order. Plugin-specific defaults were merged into the vendored
// loaders above; no highest-priority environment override is needed.
const config = path.join(source, "packages/core/src/config.ts")
await replaceOnce(config, 'import { ChildProcess } from "effect/process"',
  'import { ChildProcess } from "effect/process"\nimport qolDefaults from "./plugin/qol/defaults/opencode.json"')
await replaceOnce(config, "        return [\n          ...managedPolicies,",
  '        const defaults = yield* parseInfo(JSON.stringify(qolDefaults), "opencode-qol defaults")\n' +
  '        return [\n          ...(defaults ? [new Document({ type: "document", info: defaults })] : []),\n          ...managedPolicies,')
