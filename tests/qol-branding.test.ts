// Focused checks for patches/qol-branding.patch and assets/branding.
// The patched packages/tui/src/logo.ts is reconstructed from its full-file hunk,
// so the version helpers run without the upstream tree.
// Set OPENCODE_QOL_UPSTREAM=<official source> to also dry-run the patch against it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.join(import.meta.dir, "..");
const PATCH = path.join(ROOT, "patches/qol-branding.patch");

type LogoModule = {
  logo: { left: string[]; right: string[] };
  go: { left: string[]; right: string[] };
  qolVersion: (version: string) => string;
  qolVersionLabel: (version: string) => string;
};

let patch: string;
let mod: LogoModule;
let directory: string;

function sections(text: string) {
  const out = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of text.split("\n")) {
    const match = /^diff --git a\/(\S+) b\//.exec(line);
    if (match) out.set(match[1]!, (current = []));
    else current?.push(line);
  }
  return out;
}

const added = (file: string) =>
  (sections(patch).get(file) ?? []).filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1));

beforeAll(async () => {
  patch = await readFile(PATCH, "utf8");
  const body = sections(patch).get("packages/tui/src/logo.ts")!;
  const hunk = body.findIndex((l) => l.startsWith("@@"));
  // Full-file hunk: starts at line 1 and keeps all 9 upstream lines as context.
  expect(body[hunk]).toMatch(/^@@ -1,9 \+1,\d+ @@/);
  const file = body
    .slice(hunk + 1)
    .filter((l) => !l.startsWith("-") && !l.startsWith("\\"))
    .map((l) => l.slice(1))
    .join("\n");
  directory = await mkdtemp(path.join(process.env.TMPDIR ?? tmpdir(), "qol-branding-"));
  await writeFile(path.join(directory, "logo.ts"), file);
  mod = await import(path.join(directory, "logo.ts"));
});

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("display version", () => {
  test("appends -qol exactly once to the real base version", () => {
    expect(mod.qolVersion("2.1.4")).toBe("2.1.4-qol");
    expect(mod.qolVersion("2.1.4-qol")).toBe("2.1.4-qol");
    expect(mod.qolVersion(mod.qolVersion("2.1.4"))).toBe("2.1.4-qol");
    expect(mod.qolVersion("v2.1.4")).toBe("2.1.4-qol");
    expect(mod.qolVersion("local")).toBe("local-qol");
    expect(mod.qolVersion("")).toBe("");
  });

  test("follows a future core bump instead of pinning a number", () => {
    expect(mod.qolVersion("2.2.0")).toBe("2.2.0-qol");
    expect(mod.qolVersionLabel("2.2.0")).toBe("v2.2.0-qol");
    for (const line of patch.split("\n").filter((l) => l.startsWith("+"))) expect(line).not.toMatch(/\d+\.\d+\.\d+/);
  });

  test("visible label is v2.1.4-qol and never doubles the v or suffix", () => {
    expect(mod.qolVersionLabel("2.1.4")).toBe("v2.1.4-qol");
    expect(mod.qolVersionLabel("v2.1.4-qol")).toBe("v2.1.4-qol");
    expect(mod.qolVersionLabel("local")).toBe("local-qol");
  });

  test("only display sites use the suffix; OPENCODE_VERSION stays the real base", () => {
    const cli = added("packages/cli/src/index.ts").join("\n");
    expect(cli).toContain("Runtime.run(Commands, Handlers, { version: qolVersion(OPENCODE_VERSION) })");
    expect(patch).not.toMatch(/^\+.*OPENCODE_VERSION\s*[:=]/m);
    expect(patch).not.toContain("packages/cli/src/version.ts");
    expect(patch).not.toContain("services/updater.ts");
    expect(added("packages/tui/src/feature-plugins/home/footer.tsx").join("\n")).toContain(
      "{qolVersionLabel(props.context.app.version)}",
    );
    expect(added("packages/tui/src/component/dialog-debug.tsx").join("\n")).toContain("qolVersion(app.version)");
    expect(added("packages/tui/src/mini/splash.ts").join("\n")).toContain("version: qolVersion(input.version)");
  });
});

describe("official logo", () => {
  test("leaves the wordmark, component and home route unchanged", () => {
    const body = sections(patch).get("packages/tui/src/logo.ts")!.join("\n");
    expect(body).not.toMatch(/^-(?!-- a\/)/m);
    expect(Object.keys(mod).sort()).toEqual(["go", "logo", "qolVersion", "qolVersionLabel"].sort());
    expect(sections(patch).has("packages/tui/src/component/logo.tsx")).toBe(false);
    expect(sections(patch).has("packages/tui/src/routes/home.tsx")).toBe(false);
    expect(sections(patch).has("packages/tui/src/feature-plugins/system/stats.tsx")).toBe(false);
  });
});

describe("patch scope", () => {
  test("touches only the branding/version display files and not tui-qol-tools files", async () => {
    expect([...sections(patch).keys()].sort()).toEqual(
      [
        "packages/cli/src/index.ts",
        "packages/tui/src/component/dialog-debug.tsx",
        "packages/tui/src/feature-plugins/home/footer.tsx",
        "packages/tui/src/logo.ts",
        "packages/tui/src/mini/splash.ts",
      ].sort(),
    );
    const tools = sections(await readFile(path.join(ROOT, "patches/tui-qol-tools.patch"), "utf8"));
    for (const file of sections(patch).keys()) expect(tools.has(file)).toBe(false);
  });

  const upstream = process.env.OPENCODE_QOL_UPSTREAM;
  test.skipIf(!upstream)("applies cleanly to the official source (dry run)", () => {
    const result = spawnSync("patch", ["-p1", "--dry-run", "-s", "-d", upstream!, "-i", PATCH], { encoding: "utf8" });
    // Store sources are read-only; patch --dry-run only warns about that.
    expect((result.stdout + result.stderr).replace(/^File .* is read-only; trying to patch anyway\n/gm, "")).toBe("");
    expect(result.status).toBe(0);
  });
});
