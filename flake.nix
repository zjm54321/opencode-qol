{
  description = "OpenCode Solution: pinned OpenCode with built-in quality-of-life plugins";

  inputs = {
    opencode.url = "github:anomalyco/opencode/v2.2.5";
    nixpkgs.follows = "opencode/nixpkgs";
    ghostty-src = {
      url = "github:ghostty-org/ghostty/ab0b9da9e88fcb4b0533a1854e84628f663930af";
      flake = false;
    };

    # Built-in skills from locked declarative Flake inputs
    mattpocock-skills = {
      url = "github:mattpocock/skills";
      flake = false;
    };
    anthropic-skills = {
      url = "github:anthropics/skills";
      flake = false;
    };
    context7-src = {
      url = "github:upstash/context7";
      flake = false;
    };
    knowledge-work-plugins = {
      url = "github:anthropics/knowledge-work-plugins";
      flake = false;
    };
    wshobson-agents = {
      url = "github:wshobson/agents";
      flake = false;
    };
    apollographql-skills = {
      url = "github:apollographql/skills";
      flake = false;
    };
    trailofbits-skills = {
      url = "github:trailofbits/skills";
      flake = false;
    };
    cloudflare-skills = {
      url = "github:cloudflare/skills";
      flake = false;
    };
    ui-ux-pro-max-skill = {
      url = "github:nextlevelbuilder/ui-ux-pro-max-skill";
      flake = false;
    };
    make-interfaces-feel-better = {
      url = "github:jakubkrehel/make-interfaces-feel-better";
      flake = false;
    };
    better-icons = {
      url = "github:better-auth/better-icons";
      flake = false;
    };
    humanizer-zh = {
      url = "github:op7418/Humanizer-zh";
      flake = false;
    };
    humanizer = {
      url = "github:blader/humanizer";
      flake = false;
    };
    the-elements-of-style = {
      url = "github:obra/the-elements-of-style";
      flake = false;
    };

    # MCP servers fixed package set & vendor upstreams
    mcp-nixpkgs = {
      url = "github:NixOS/nixpkgs/885ba4d038f10c3d17d7a92e8c3cc185b99c9158";
      flake = false;
    };
    oh-my-opencode-slim-src = {
      url = "github:alvinunreal/oh-my-opencode-slim";
      flake = false;
    };
    billion-context-src = {
      url = "github:ranxianglei/billion-context";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, opencode, ghostty-src, ... }@inputs:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      pluginNodeModules = pkgs.importNpmLock.buildNodeModules {
        npmRoot = ./kernel;
        nodejs = pkgs.nodejs;
        derivationArgs = {
          npmFlags = [ "--ignore-scripts" ];
          doCheck = false;
          doInstallCheck = false;
        };
      };
      skillInputs = {
        inherit (inputs)
          mattpocock-skills
          anthropic-skills
          context7-src
          knowledge-work-plugins
          wshobson-agents
          apollographql-skills
          trailofbits-skills
          cloudflare-skills
          ui-ux-pro-max-skill
          make-interfaces-feel-better
          better-icons
          humanizer-zh
          humanizer
          the-elements-of-style;
      };
      package = import ./kernel/nix/package.nix {
        inherit pkgs opencode pluginNodeModules skillInputs;
        vendorInputs = {
          inherit (inputs) oh-my-opencode-slim-src billion-context-src;
        };
        mcpNixpkgs = inputs.mcp-nixpkgs;
        nativePty = pkgs.callPackage ./kernel/nix/pty-daemon.nix { inherit opencode ghostty-src; };
        inherit (pkgs) lib;
      };
      trial = pkgs.writeShellApplication {
        name = "opencode-trial";
        runtimeInputs = [ pkgs.coreutils ];
        runtimeEnv.OPENCODE_TRIAL_BINARY = "${package}/bin/opencode";
        text = builtins.readFile ./kernel/nix/trial.sh;
      };
    in
    {
      packages.${system} = {
        default = package;
        kernel = package;
        opencode = package;
        pty-daemon = pkgs.callPackage ./kernel/nix/pty-daemon.nix { inherit opencode ghostty-src; };
      };
      apps.${system}.default = {
        type = "app";
        program = "${trial}/bin/opencode-trial";
      };
      homeManagerModules.default = import ./kernel/modules/home-manager.nix { inherit self; };
    };
}
