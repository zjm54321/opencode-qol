import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import path from "node:path";

test("trial isolates HOME/XDG/workdir, preserves arguments and exit status, and removes its state", async () => {
  const fixture = await mkdtemp("/tmp/opencode/qol-trial-");
  try {
    const binary = path.join(fixture, "opencode");
    const record = path.join(fixture, "record");
    await writeFile(binary, `#!/usr/bin/env bash
printf '%s\\n' "$PWD" "$HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME" "$XDG_RUNTIME_DIR" "$1" > "$TRIAL_RECORD"
test -z "\${OPENCODE_CONFIG_DIR+x}" || exit 9
test "$(<"$XDG_CONFIG_HOME/opencode/service.json")" = '{"disabled":true}' || exit 10
touch "$HOME/trial-state"
exit 7
`, { mode: 0o755 });
    const child = Bun.spawn(["bash", "-euo", "pipefail", new URL("../nix/trial.sh", import.meta.url).pathname, "argument with spaces"], {
      env: { ...process.env, OPENCODE_TRIAL_BINARY: binary, TRIAL_RECORD: record, OPENCODE_CONFIG_DIR: "/not-the-trial" },
      stdout: "pipe", stderr: "pipe",
    });
    expect(await child.exited).toBe(7);
    const values = (await readFile(record, "utf8")).trim().split("\n");
    const root = path.dirname(values[0]!);
    expect(root).toMatch(/^\/tmp\/opencode-run-[a-zA-Z0-9]+$/);
    expect(values.slice(0, 7)).toEqual(["work", "home", "config", "data", "state", "cache", "runtime"].map(name => path.join(root, name)));
    expect(values[7]).toBe("argument with spaces");
    expect(await access(root).then(() => true, () => false)).toBe(false);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
