import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Flock } from "@opencode/util/flock";
import bridge, { handlers } from "../plugins/desktop-bridge/src/index.ts";
import { getModelFavorites, modelStatePath, replaceFavorite, setModelFavorites } from "../plugins/desktop-bridge/src/model-favorites.ts";
import { definition, hello, parseInput } from "../plugins/desktop-bridge/src/protocol.ts";

let workspace: string;
let statePath: string;
let originalStateHome: string | undefined;
const favorites = { favorites: [{ providerID: "openai", modelID: "gpt-test" }] };
const sample = ' {\n "recent": [{"providerID":"p","modelID":"r"}], "favorite": [],\n "variant": {"p/m":"high"}, "unknown": {"large":900719925474099312345,"s":"},\\\"favorite\\\":"}\n}\n';

beforeEach(async () => {
  const root = path.join(tmpdir(), "opencode");
  await fs.mkdir(root, { recursive: true });
  workspace = await fs.mkdtemp(path.join(root, "qol-desktop-bridge-"));
  statePath = path.join(workspace, "model.json");
  originalStateHome = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = workspace;
});

afterEach(async () => {
  mock.restore();
  if (originalStateHome === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = originalStateHome;
  await fs.rm(workspace, { recursive: true, force: true });
});

describe("desktop bridge model favorites", () => {
  test("negotiates both capabilities and registers all authoritative handlers", async () => {
    expect(hello({ protocolVersions: [1] })).toEqual({ protocolVersion: 1, capabilities: ["billion.origin.v1", "model.favorites.v1"] });
    expect(hello({ protocolVersions: [2] })).toEqual({ protocolVersion: null, supportedVersions: [1], capabilities: [] });
    const dispose = mock(async () => {});
    const register = mock(async (schema, methods) => {
      expect(schema).toBe(definition);
      expect(methods).toBe(handlers);
      return { dispose };
    });
    const cleanup = await bridge.setup({ rpc: { register } });
    const first = cleanup();
    expect(cleanup()).toBe(first);
    await first;
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(Object.keys(handlers)).toEqual(["hello", "billion.origin", "model.favorites.get", "model.favorites.set"]);
  });

  test("missing state reads empty and RPC get/set use the configured standard state path", async () => {
    expect(modelStatePath()).toBe(path.join(workspace, "opencode", "model.json"));
    expect(await handlers["model.favorites.get"]({})).toEqual({ favorites: [] });
    expect(await handlers["model.favorites.set"](favorites)).toEqual(favorites);
    expect(await handlers["model.favorites.get"]({})).toEqual(favorites);
    expect((await fs.stat(modelStatePath())).mode & 0o777).toBe(0o600);
  });

  test.each([
    null, [], {}, { favorites: [{ providerID: "", modelID: "m" }] },
    { favorites: [{ providerID: "has space", modelID: "m" }] },
    { favorites: [{ providerID: "p", modelID: "m", extra: true }] },
    { favorites: [], path: "/arbitrary" },
    { favorites: Array.from({ length: 201 }, () => ({ providerID: "p", modelID: "m" })) },
  ].map(input => ({ input })))("set rejects malformed input before filesystem writes: %j", async ({ input }) => {
    await expect(setModelFavorites(input, statePath)).rejects.toThrow("Invalid model.favorites.set input");
    expect(await fs.readdir(workspace)).toEqual([]);
  });

  test("get validates both its empty request and stored favorite values", async () => {
    await expect(handlers["model.favorites.get"]({ path: statePath })).rejects.toThrow("Invalid model.favorites.get input");
    await fs.writeFile(statePath, '{"favorite":[{"providerID":"p","modelID":5}]}');
    await expect(getModelFavorites(statePath)).rejects.toThrow("Invalid model.favorites output");
  });

  test("replacement preserves every other byte, including unknown fields and large integers", async () => {
    const expected = sample.replace('"favorite": []', '"favorite": ' + JSON.stringify(favorites.favorites));
    expect(replaceFavorite(sample, favorites)).toBe(expected);
    await fs.writeFile(statePath, sample);
    await setModelFavorites(favorites, statePath);
    expect(await fs.readFile(statePath, "utf8")).toBe(expected);
    expect(await getModelFavorites(statePath)).toEqual(favorites);
    expect((await fs.readdir(workspace)).filter(name => name.endsWith(".tmp"))).toEqual([]);
  });

  test("replacement supports escaped/duplicate favorite keys and nested favorite members", () => {
    const raw = '{"fa\\u0076orite": [], "nested":{"favorite":[1]}, "favorite": [2], "n":9007199254740993}';
    const value = JSON.stringify(favorites.favorites);
    expect(replaceFavorite(raw, favorites)).toBe(`{"fa\\u0076orite": ${value}, "nested":{"favorite":[1]}, "favorite": ${value}, "n":9007199254740993}`);
    expect(replaceFavorite('{"n":9007199254740993}', favorites)).toBe(`{"n":9007199254740993,"favorite":${value}}`);
  });

  test.each(["[]", "null", "not-json"])("invalid state is refused without overwriting it: %s", async raw => {
    await fs.writeFile(statePath, raw);
    await expect(setModelFavorites(favorites, statePath)).rejects.toThrow();
    expect(await fs.readFile(statePath, "utf8")).toBe(raw);
    expect((await fs.readdir(workspace)).filter(name => name.endsWith(".tmp"))).toEqual([]);
  });

  test("failed atomic rename cleans up its temporary file and preserves original state", async () => {
    await fs.writeFile(statePath, sample);
    spyOn(fs, "rename").mockRejectedValueOnce(new Error("rename failed"));
    await expect(setModelFavorites(favorites, statePath)).rejects.toThrow("rename failed");
    expect(await fs.readFile(statePath, "utf8")).toBe(sample);
    expect((await fs.readdir(workspace)).filter(name => name.endsWith(".tmp"))).toEqual([]);
  });

  test("shared official Flock serializes the complete read/replace/rename against TUI updates", async () => {
    await fs.writeFile(statePath, sample);
    const lockDir = path.join(path.dirname(statePath), "locks");
    const lease = await Flock.acquire(statePath, { dir: lockDir });
    const withLock = Flock.withLock;
    let waiting!: () => void;
    const blocked = new Promise<void>(resolve => { waiting = resolve; });
    const lock = spyOn(Flock, "withLock").mockImplementation((key, fn, options) =>
      withLock(key, fn, { ...options, onWait: () => waiting() }));
    const update = setModelFavorites(favorites, statePath);
    const tuiState = sample.replace('"modelID":"r"', '"modelID":"new-recent"').replace('"high"', '"new-variant"');
    try {
      await blocked;
      expect(lock).toHaveBeenCalledWith(statePath, expect.any(Function), { dir: lockDir });
      expect(await fs.readFile(statePath, "utf8")).toBe(sample);
      // Same critical section as official TUI read -> patch -> atomic write.
      const temp = `${statePath}.tui.tmp`;
      await fs.writeFile(temp, tuiState);
      await fs.rename(temp, statePath);
    } finally { await lease.release(); }
    await update;
    expect(await fs.readFile(statePath, "utf8")).toBe(replaceFavorite(tuiState, favorites));
    expect(await getModelFavorites(statePath)).toEqual(favorites);
  });

  test("protocol schemas continue rejecting wrong hello and set outputs", () => {
    expect(() => hello({ protocolVersions: [1], extra: true })).toThrow("Invalid hello input");
    expect(() => parseInput(definition.methods["model.favorites.set"].output, { favorites: [{ providerID: "p", modelID: "bad\nvalue" }] })).toThrow("Invalid model.favorites output");
  });
});
