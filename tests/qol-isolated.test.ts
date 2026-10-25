import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

const script = await Bun.file(new URL("../run-isolated.sh", import.meta.url)).text()
const seed = script.match(/# Seed history once[\s\S]*?\nfi/)?.[0]
if (!seed) throw new Error("Missing isolated history initialization")
let directory: string
let home: string
let data: string
let production: string
let isolated: string

beforeEach(async () => {
  directory = await mkdtemp("/tmp/opencode/qol-isolated-")
  home = path.join(directory, "home with spaces")
  data = path.join(directory, "isolated data")
  production = path.join(home, ".local/share/opencode")
  isolated = path.join(data, "opencode")
  await mkdir(production, { recursive: true })
})

afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

async function initialize() {
  const process = Bun.spawn(["bash", "-euc", seed!], {
    env: { ...Bun.env, HOME: home, DATA_DIR: data }, stdout: "pipe", stderr: "pipe",
  })
  const stderr = await new Response(process.stderr).text()
  expect(stderr).toBe("")
  expect(await process.exited).toBe(0)
}

test("copies history and SQLite sidecars once without linking production files", async () => {
  for (const suffix of ["", "-wal", "-shm"]) {
    await writeFile(path.join(production, `opencode.db${suffix}`), `production${suffix}`)
  }
  await initialize()
  for (const suffix of ["", "-wal", "-shm"]) {
    const target = path.join(isolated, `opencode.db${suffix}`)
    expect(await readFile(target, "utf8")).toBe(`production${suffix}`)
    await writeFile(target, `isolated${suffix}`)
    expect(await readFile(path.join(production, `opencode.db${suffix}`), "utf8")).toBe(`production${suffix}`)
  }
  await initialize()
  expect(await readFile(path.join(isolated, "opencode.db"), "utf8")).toBe("isolated")
})

test("starts with no history when the production database does not exist", async () => {
  await initialize()
  expect(await Bun.file(path.join(isolated, "opencode.db")).exists()).toBe(false)
})

test("copies a database without sidecars", async () => {
  await writeFile(path.join(production, "opencode.db"), "history")
  await initialize()
  expect(await readFile(path.join(isolated, "opencode.db"), "utf8")).toBe("history")
})
