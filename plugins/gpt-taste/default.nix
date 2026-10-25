{ lib, pkgs }:
let
  # Appended as the last system part for every model whose ID contains "gpt"
  # (core's GPT detection in packages/core/src/plugin/optimize.ts), except gpt-oss.
  # Every GPT agent gets base.md; the agents listed in `roles` get their own text after it.
  # Texts are excerpts from NB-Corp/gpt-with-taste (MIT, 27e7da1): base and fixer from
  # recipe/sub.md, orchestrator from recipe/main.md.
  read = file: lib.trim (builtins.readFile file);
  base = read ./base.md;
  roles = {
    orchestrator = read ./orchestrator.md;
    fixer = read ./fixer.md;
  };
  javascript = ''
    const base = ${builtins.toJSON base};
    const roles = ${builtins.toJSON roles};

    const isGPT = (model) => {
      const id = String(model?.id ?? "").toLowerCase();
      return id.includes("gpt") && !id.includes("gpt-oss");
    };

    const textFor = (agent) => {
      const role = Object.hasOwn(roles, agent) ? roles[agent] : undefined;
      return role ? base + "\n\n" + role : base;
    };

    const append = (event) => {
      if (!isGPT(event.model)) return;
      const text = textFor(event.agent);
      if (event.system.some((part) => part?.type === "text" && part.text === text)) return;
      event.system.push({ type: "text", text });
    };

    export default {
      id: "gpt-taste",
      async setup(ctx) {
        const registrations = await Promise.all(
          ["context", "compaction", "generate"].map((name) => ctx.session.hook(name, append)),
        );
        return () => Promise.all(registrations.map((registration) => registration.dispose()));
      },
    };
  '';
  packageJson = pkgs.writeText "opencode-gpt-taste-package.json" (
    builtins.toJSON {
      name = "gpt-taste";
      version = "0.0.0";
      private = true;
      type = "module";
      exports = {
        "." = "./index.js";
        "./server" = "./index.js";
      };
    }
  );
  index = pkgs.writeText "opencode-gpt-taste-index.js" javascript;
in
pkgs.runCommand "opencode-gpt-taste" { } ''
  install -Dm644 ${packageJson} "$out/package.json"
  install -Dm644 ${index} "$out/index.js"
''
