import { expect, test } from "bun:test";
import config from "../defaults/oh-my-opencode-slim.json";
import opencode from "../defaults/opencode.json";

test("official provider is enabled in distributable defaults", () => {
  expect(opencode).not.toHaveProperty("disabled_providers");
  expect(opencode).not.toHaveProperty("policies");
});

test("free preset preserves specialist skills and MCP isolation", () => {
  const preset = config.presets.free;
  expect(preset.orchestrator.model).toBe("opencode/glm-5.3-flash-free");
  expect(preset.orchestrator.variant).toBe("max");
  expect(preset.fixer.model).toBe("opencode/deepseek-v4.1-flash-free");
  expect(preset.fixer.variant).toBe("max");
  expect(preset.oracle.model).toBe("opencode/nemotron-3-ultra-free");
  expect(preset.explorer.model).toBe("opencode/nemotron-3.5-lightning-free");
  expect(preset.designer.model).toBe("opencode/mimo-v2.6-flash-free");
  expect(preset.documenter.model).toBe("opencode/mimo-v2.6-flash-free");
  expect(preset.council.model).toBe("opencode/deepseek-v4.1-flash-free");
  for (const role of ["fixer", "oracle", "explorer", "designer", "documenter"] as const) {
    expect(preset[role].skills).toEqual(config.agents[role].skills);
    expect(preset[role].mcps).toEqual(config.agents[role].mcps);
    for (const skill of preset[role].skills) expect(preset.orchestrator.skills).toContain(`!${skill}`);
  }
  expect(preset.orchestrator.mcps).toEqual(["codegraph", "nixos"]);
  expect(preset.council.mcps).toEqual(["codegraph"]);
  expect(config.marketplacePresets.free.agents).toEqual(["alvin/documenter"]);
  expect(config.council.presets.free).toEqual({
    alpha: { model: "opencode/nemotron-3-ultra-free" },
    beta: { model: "opencode/nemotron-3.5-lightning-free" },
    gamma: { model: "opencode/glm-5.3-flash-free" },
  });
});
