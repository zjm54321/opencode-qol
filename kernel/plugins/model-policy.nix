{
  lib,
  pkgs,
  originalProviders,
}:
let
  allowed =
    provider: modelID:
    (!(provider ? whitelist) || builtins.elem modelID provider.whitelist)
    && !(builtins.elem modelID (provider.blacklist or [ ]));
  policy = lib.mapAttrs (
    _: provider:
    lib.optionalAttrs (provider ? whitelist) { inherit (provider) whitelist; }
    // lib.optionalAttrs (provider ? blacklist) { inherit (provider) blacklist; }
  ) originalProviders;
  providers = lib.mapAttrs (
    _: provider:
    (builtins.removeAttrs provider [
      "whitelist"
      "blacklist"
    ])
    // lib.optionalAttrs (provider ? models) {
      models = lib.filterAttrs (modelID: _: allowed provider modelID) provider.models;
    }
  ) originalProviders;
  javascript = ''
    import { readFile } from "node:fs/promises";
    import { homedir } from "node:os";
    import path from "node:path";

    const policyMap = ${builtins.toJSON policy};

    const shouldKeep = (providerID, modelID, policies = policyMap) => {
      const policy = policies[providerID];
      if (!policy) return true;
      if (Object.hasOwn(policy, "whitelist") && !policy.whitelist.includes(modelID)) return false;
      return !(policy.blacklist ?? []).includes(modelID);
    };

    async function loadPolicies(directory) {
      const policies = structuredClone(policyMap);
      const configHome = process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config");
      // Match config precedence: baked defaults < global < project.
      const files = new Set([
        path.join(configHome, "opencode", "opencode.json"),
        path.join(directory, "opencode.json"),
      ]);
      for (const file of files) {
        let text;
        try {
          text = await readFile(file, "utf8");
        } catch (error) {
          if (error.code === "ENOENT") continue;
          throw error;
        }
        let config;
        try {
          config = JSON.parse(text);
          if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error();
        } catch {
          // Never include config contents, which may contain provider credentials.
          throw new Error(`Invalid model policy configuration at ''${file}: expected a JSON object.`);
        }
        for (const providers of [config.provider, config.providers]) {
          for (const [providerID, provider] of Object.entries(providers ?? {})) {
            for (const key of ["whitelist", "blacklist"]) {
              if (!provider || !Object.hasOwn(provider, key)) continue;
              const models = provider[key];
              if (!Array.isArray(models) || models.some((model) => typeof model !== "string")) {
                throw new Error(`Invalid model policy at ''${file}: ''${providerID}.''${key} must be an array of model IDs.`);
              }
              policies[providerID] = { ...policies[providerID], [key]: models };
            }
          }
        }
      }
      return policies;
    }

    export { policyMap, shouldKeep };

    export default {
      id: "opencode.qol.model-policy",
      async setup(ctx) {
        const policies = await loadPolicies(ctx.location.directory);
        const registration = await ctx.model.transform((editor) => {
          for (const model of editor.list()) {
            if (!shouldKeep(model.providerID, model.id, policies)) editor.remove(model.providerID, model.id);
          }
        });
        return () => registration.dispose();
      },
    };
  '';
  packageJson = pkgs.writeText "opencode-provider-model-policy-package.json" (
    builtins.toJSON {
      name = "provider-model-policy";
      version = "0.0.0";
      private = true;
      type = "module";
      exports = {
        "." = "./index.js";
        "./server" = "./index.js";
      };
    }
  );
  index = pkgs.writeText "opencode-provider-model-policy-index.js" javascript;
  package = pkgs.runCommand "opencode-provider-model-policy" { } ''
    install -Dm644 ${packageJson} "$out/package.json"
    install -Dm644 ${index} "$out/index.js"
  '';
in
{
  inherit
    javascript
    package
    policy
    providers
    ;
}
