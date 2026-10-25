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
    const policyMap = ${builtins.toJSON policy};

    const shouldKeep = (providerID, modelID) => {
      const policy = policyMap[providerID];
      if (!policy) return true;
      if (Object.hasOwn(policy, "whitelist") && !policy.whitelist.includes(modelID)) return false;
      return !(policy.blacklist ?? []).includes(modelID);
    };

    export { policyMap, shouldKeep };

    export default {
      id: "provider-model-policy",
      async setup(ctx) {
        const registration = await ctx.model.transform((editor) => {
          for (const model of editor.list()) {
            if (!shouldKeep(model.providerID, model.id)) editor.remove(model.providerID, model.id);
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
