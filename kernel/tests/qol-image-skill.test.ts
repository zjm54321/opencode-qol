import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"

const ROOT = path.join(import.meta.dir, "../defaults/skills/image-generation")
// OpenCode 2.2.5 packages/core/src/tool/plugin/image-generate.ts:26,47-72,307-374.
// Keep this check portable: it reads the shipped skill, not a machine-specific store path or live providers.
const TOOL = "experimental_image_generate"
const INPUTS = ["prompt", "images", "model", "path"]

async function markdownFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await markdownFiles(file))
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(file)
  }
  return files.sort()
}

const documents = await Promise.all((await markdownFiles(ROOT)).map(async (file) => ({
  file,
  text: await readFile(file, "utf8"),
})))

function markdown(relative: string): string {
  const file = path.join(ROOT, relative)
  const document = documents.find((document) => document.file === file)
  if (!document) throw new Error(`Missing image skill Markdown: ${file}`)
  return document.text
}

// Check related concepts in the same paragraph rather than freezing whole prose sentences or headings.
function hasGuidance(text: string, ...concepts: RegExp[]): boolean {
  return text.split(/\n\s*\n/).some((paragraph) => concepts.every((concept) => concept.test(paragraph)))
}

const parent = markdown("SKILL.md")
const fields = Object.fromEntries([...parent.matchAll(/^\s*[-*]\s+`([a-z][A-Za-z0-9_]*)`\s*:\s*(.+)$/gm)]
  .map((match) => [match[1], match[2]]))

describe("native image skill contract", () => {
  test.each(["SKILL.md", "subskills/openai/SKILL.md", "subskills/nanobanana/SKILL.md"])("%s routes execution to the native tool", (file) => {
    expect(markdown(file)).toContain(TOOL)
  })

  test("documented inputs are exactly prompt/images/model/path, with native reference limits", () => {
    expect(Object.keys(fields).sort()).toEqual([...INPUTS].sort())
    expect(fields.prompt).toMatch(/generat|creat|edit/i)
    expect(fields.images).toMatch(/\b(?:eight|8)\b/i)
    expect(fields.images).toMatch(/\b20\s*MiB\b/i)
    for (const format of ["PNG", "JPEG", "WebP", "GIF"]) expect(fields.images).toContain(format)
    expect(fields.images).toMatch(/\bpaths?\b/i)
    expect(fields.images).toMatch(/\bHTTP\(?S\)?\b/i)
    expect(fields.images).toMatch(/\brelative\b/i)
    expect(fields.images).toMatch(/\babsolute\b/i)
  })

  test("model is normally omitted and explicit models/variants require image-catalog lookup", () => {
    expect(hasGuidance(parent, /\bmodel\b/i, /\b(?:omit|unset)\b/i, /\b(?:normally|default|unless)\b/i)).toBe(true)
    expect(hasGuidance(parent, /\bmodels\b/, /\btype\s*:\s*["']image["']/, /\bexplicit\w*\b/i, /\buser\b/i)).toBe(true)
    expect(hasGuidance(parent, /\bvariant\b/i, /providerID\/modelID#variant/, /providerID\/modelID/)).toBe(true)
    expect(hasGuidance(parent, /\bmodel\b/i, /\b(?:not|never|don't)\b/i, /\b(?:invent|guess)\b/i)).toBe(true)
  })

  test("generation and additional images require user authorization", () => {
    expect(hasGuidance(parent, /\b(?:generat\w*|edit)\b/i, /\buser\b/i, /\bonly\b/i, /\basks?\b/i)).toBe(true)
    expect(hasGuidance(parent, /\b(?:another|repeat|version)\b/i, /\bonly\b/i, /\buser\b/i, /\brequests?\b/i)).toBe(true)
    expect(hasGuidance(parent, /\b(?:each|single)\s+call\b/i, /\b(?:one|1)\s+image\b/i)).toBe(true)
  })

  test("background startup is not completion, and waiting never polls or repeats paid requests", () => {
    expect(hasGuidance(parent, /\bbackground\b/i, /\bjob\s+ID\b/i, /\bpath\s+stem\b/i, /\bnot\b/i, /\bfinished\b/i)).toBe(true)
    expect(hasGuidance(parent, /\bautomatic\b/i, /\b(?:completion|finish)\w*\b/i, /\b(?:notice|notification)\b/i)).toBe(true)
    for (const activity of [/\bpoll\b/i, /\bsleep\b/i, /\brepeat\b/i, /\b(?:search|check)\b/i]) {
      expect(hasGuidance(parent, /\b(?:not|never|don't|avoid)\b/i, activity, /\bwait\w*\b/i)).toBe(true)
    }
    expect(hasGuidance(parent, /\bfail\w*\b/i, /\berror\b/i, /\b(?:instead of|not|never)\b/i, /\b(?:another|repeat|retry)\b/i)).toBe(true)
  })

  test.each(["SKILL.md", "subskills/openai/SKILL.md", "subskills/nanobanana/SKILL.md"])("%s passes previous saved images explicitly for follow-up edits", (file) => {
    expect(hasGuidance(markdown(file), /\bimages\b/, /\b(?:previous|prior|preceding|approved)\b/i, /\b(?:pass|include|use)\b/i, /\bexplicit\w*\b/i)).toBe(true)
  })

  test("output paths describe optional destinations, real-format extensions, replacement and temporary defaults", () => {
    expect(fields.path).toMatch(/\boptional\b/i)
    expect(fields.path).toMatch(/\brelative\b/i)
    expect(fields.path).toMatch(/\bsession\b/i)
    expect(fields.path).toMatch(/\babsolute\b/i)
    expect(fields.path).toMatch(/\b(?:actual|real)\s+format\b/i)
    expect(fields.path).toMatch(/\bextension\b/i)
    expect(fields.path).toMatch(/\boverwrit\w*\b/i)
    expect(fields.path).toMatch(/\b(?:temporary|temp)\b/i)
    expect(hasGuidance(parent, /\b(?:actual|exact)\b/i, /\bsaved\s+path\b/i, /\bnotice\b/i, /\bread\b/i)).toBe(true)
  })

  test("exact alpha/output controls require a compatible configured preset, with no silent substitute", () => {
    expect(hasGuidance(parent, /\b(?:transparent|alpha)\b/i, /\b(?:settings|variants?)\b/i, /\b(?:no|not)\b/i, /\b(?:per-call|tool)\b/i)).toBe(true)
    expect(hasGuidance(parent, /\brequired\b/i, /\b(?:unavailable|missing)\b/i, /\buser\b/i, /\bbefore\s+generat\w*\b/i)).toBe(true)
    expect(hasGuidance(parent, /\btransparent\b/i, /\bopaque\b/i, /\b(?:not|never|don't)\b/i, /\bsubstitut\w*\b/i)).toBe(true)
  })

  test("active Markdown contains no retired plugin tools, configuration or argument identifiers", () => {
    // Historical upstream filenames (including scripts/image_gen.py) belong in original_files, not live recipes.
    const retired = /\b(?:image_gen|image_gen_nano|image_models|image_providers|image_generation|imagegen\.json|aspect_ratio|transparent_background|referenced_image_paths|num_last_images_to_include|session_id)\b|plugins\/image/g
    const violations = documents.flatMap(({ file, text }) => text.split("\n").flatMap((line, index) =>
      [...line.matchAll(retired)].map((match) => `${file}:${index + 1}: ${match[0]}`),
    ))
    expect(violations).toEqual([])
  })

  test("reference prose never invents native inputs or denies the supported path argument", () => {
    const violations: string[] = []
    for (const { file, text } of documents) {
      for (const [index, line] of text.split("\n").entries()) {
        const location = `${file}:${index + 1}`
        const inputClaim = /\b(?:tool|schema)\b/i.test(line)
          && /\b(?:arguments?|parameters?|inputs?|fields?|accepts|supports|exposes)\b/i.test(line)
          && /\b(?:accepts|supports|supported|exposes|pass|use)\b/i.test(line)
          && !/\b(?:no|not|neither|nor|never|without|settings|configuration|configured|variants?)\b/i.test(line)
        if (inputClaim) {
          for (const match of line.matchAll(/`([a-z][A-Za-z0-9_]*)`/g)) {
            if (!INPUTS.includes(match[1]) && match[1] !== TOOL) violations.push(`${location}: unsupported input ${match[1]}`)
          }
        }
        const deniesPath = /\b(?:output\s+)?paths?\b[^;.!?\n]{0,100}\b(?:not|never|no)\b[^;.!?\n]{0,60}\btool\s+(?:inputs?|arguments?|parameters?|fields?)\b/i.test(line)
          || /\b(?:no|neither|does not (?:support|accept|expose))\b[^;.!?\n]{0,60}\b(?:output\s+)?paths?\b[^;.!?\n]{0,40}\b(?:inputs?|arguments?|parameters?|fields?)\b/i.test(line)
        if (deniesPath) violations.push(`${location}: denies native path input`)
      }
    }
    expect(violations).toEqual([])
  })
})

const ORIGINALS = {
  openai: {
    repository: "https://github.com/openai/skills.git",
    directory: "skills/.system/imagegen",
    commit: "e6afb0d74cc75d220df2faf3dd6c635c2dc6a108",
    original_files: {
      "agents/openai.yaml": "fafccbf7ded0d78be24c7dc1c0a2e0ac1bbf27bfd13a1fed969da643d973826a",
      "assets/imagegen-small.svg": "cff5f34f57ff60b3ee92eaedd17b15e96dd4b9e776df3e78936c9e00d42be294",
      "assets/imagegen.png": "95952f644064eb9e890f98d8db07216347186526e4c41ad66d3420629eb86e20",
      "LICENSE.txt": "4dd13869245e356246a5b770723247bbb80a8f07a181d1d3d873a1734297cdb9",
      "references/cli.md": "4d471758fb136146a51848fb9cdea0c7e03dac834a426307b0b66290e850ce46",
      "references/codex-network.md": "dd6e85cb3da3589cab0f65be15b2c8f9d19633d9490f0a4b0fef5fd243d0464c",
      "references/image-api.md": "005d8db53d05223dda473f255b3576b95dff239d6dfbf544a454110e98aa87b5",
      "references/prompting.md": "e547ff9fe8e0de8e844c70a550e0b66e0f72323307e5acd0e562678f10eb0db2",
      "references/sample-prompts.md": "82b0e14db9eace50fca0a4e728b535ded0f3661893538e6b15b18a9a82b71d5b",
      "scripts/image_gen.py": "eaffd8fe4cde5722d748cc35729a03438d6b8fda5e84edd46ea1ce521d41f58b",
      "SKILL.md": "826d05b806d51fa81cd650f1c0854b0a1f7fbccd1b152c588ded1797a2e7218f",
    },
  },
  nanobanana: {
    repository: "https://github.com/AntonioCardenas/generate-nanobanana.git",
    directory: ".",
    commit: "725d003705b432a9ee8ffeb209a48aeb149c019b",
    original_files: {
      ".gitignore": "cf237c7aff44efbe6e502e645c3e06da03a69d7bdeb43392108ef3348143417e",
      "CODE_OF_CONDUCT.md": "8b3dc743993f08c0208280eaade0f94bab16e18274e5c5b47f61441581549d76",
      "CONTRIBUTING.md": "e993a89379397ad387002c3065bdfa541f00702e57e71c46533556b5b873cfee",
      "LICENSE": "2b46b3e26d28d726b6bc5401cbc58dae3054801d804abc9657c254668ae32a18",
      "models/gemini-omni-flash.md": "066476b9be352df96d5c0257b8bfb487a32cd366a313642d5def7485e7e9c8c2",
      "models/nano-banana-2-lite.md": "84083493160e29b8494354e05af8e6651a32cb9a615d038576ecde9ec3fa8567",
      "models/nano-banana-2.md": "32802a3852d069a76c8ee322c82160938343b2d2f46fdc535d575fc19b165b09",
      "models/nano-banana-pro.md": "8f4612081e7d4c451be9ff959de7c2839cf02c323dc819495a26b8695d54de19",
      "nanobanana_y2k_poster.png": "700a579dacca32f70ce669f5fc10e5f74ce125765250c32dcfa4c3388e93413d",
      "package.json": "72889e25518367f6dd1d9cbcee531de791c8433eb69a884c7eb4fad3e4b71237",
      "README.es.md": "8a8b8ad3a39ba56ae4850bcf6d70df80294b976b3c8cd23dd62a8831b7943020",
      "README.md": "1327a5475d1a7c50e4c1ff7ac0c8b8fc88d7918c566cd80b86c53f270869650a",
      "SECURITY.md": "6611659920b42b8c0bd481125e7f17eae591a5280c91fcca30c88c23ba62c00d",
      "SKILL.md": "cbc3b104d27f8fcdf6fd437ce2ae2e668cb9d5563d94b74e5b318bb7928bf3f9",
    },
  },
}

describe("retained image skill attribution", () => {
  test("source pins and all original hash keys survive prose adaptation unchanged", async () => {
    const upstreams = JSON.parse(await readFile(path.join(ROOT, "upstreams.json"), "utf8"))
    expect(Object.keys(upstreams).sort()).toEqual(Object.keys(ORIGINALS).sort())
    for (const [name, original] of Object.entries(ORIGINALS)) {
      expect(upstreams[name]).toMatchObject(original)
      expect(upstreams[name].original_files).toEqual(original.original_files)
    }
    expect(await Bun.file(path.join(ROOT, "subskills/openai/scripts/image_gen.py")).exists()).toBe(false)
  })

  test.each([
    ["subskills/openai/LICENSE.txt", ORIGINALS.openai.original_files["LICENSE.txt"]],
    ["subskills/nanobanana/LICENSE", ORIGINALS.nanobanana.original_files.LICENSE],
    ["subskills/nanobanana/SOURCE", "a77cb57b74a1ce33e05b930055a93c99137c9ee9d038f097992b2f9da6ad324c"],
  ])("%s retains its license/provenance bytes", async (file, expected) => {
    expect(createHash("sha256").update(await readFile(path.join(ROOT, file))).digest("hex")).toBe(expected)
  })
})
