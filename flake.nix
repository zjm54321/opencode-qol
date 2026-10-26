{
  description = "OpenCode Solution: pinned OpenCode with built-in quality-of-life plugins";

  inputs = {
    opencode.url = "github:anomalyco/opencode/v2.1.4";
    nixpkgs.follows = "opencode/nixpkgs";
    pty-src = {
      url = "github:anomalyco/opencode-pty/443945a666cad3b0c00da0c1c9f2bcd5bc00e28a";
      flake = false;
    };
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
      url = "github:NixOS/nixpkgs/02c087f3fe673c9e317f206a627cb6b910336dbe";
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

  outputs = { self, nixpkgs, opencode, pty-src, ghostty-src, ... }@inputs:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      pluginNodeModules = pkgs.importNpmLock.buildNodeModules {
        npmRoot = ./.;
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
      package = import ./nix/package.nix {
        inherit pkgs opencode pluginNodeModules skillInputs;
        mcpNixpkgs = inputs.mcp-nixpkgs;
        nativePty = pkgs.callPackage ./nix/pty-daemon.nix { inherit pty-src ghostty-src; };
        inherit (pkgs) lib;
      };
    in
    {
      packages.${system} = {
        default = package;
        pty-daemon = pkgs.callPackage ./nix/pty-daemon.nix { inherit pty-src ghostty-src; };
      };
      apps.${system}.default = {
        type = "app";
        program = "${package}/bin/opencode";
      };
      homeManagerModules.default = import ./modules/home-manager.nix { inherit self; };
    };
}
