{ pkgs, mcpNixpkgs ? null }:
let
  toolsSource = if mcpNixpkgs != null then mcpNixpkgs else (builtins.fetchTree {
    type = "github";
    owner = "NixOS";
    repo = "nixpkgs";
    rev = "885ba4d038f10c3d17d7a92e8c3cc185b99c9158";
    narHash = "sha256-e/yiZ31gXRROBDcnOtT3YwDQ73NVG9Cepccbt86LIn8=";
  });
  tools = import toolsSource { inherit (pkgs.stdenv.hostPlatform) system; };
  inherit (tools) lib;
  upstreamCodegraph = tools.codegraph;
  nixos = tools.mcp-nixos;
  codegraphLicense = tools.fetchurl {
    url = "https://raw.githubusercontent.com/colbymchenry/codegraph/v1.6.2/LICENSE";
    hash = "sha256-5tmPmMZmvr4GWsJJKgoZIyzDGNTWe6w8pC/7d7rMiAk=";
  };
  # Upstream's release keeps dependency licenses under lib/node_modules, but its
  # Nix recipe doesn't install the project's own LICENSE. Carry that alongside
  # our launcher without rewriting or rebuilding any server implementation.
  codegraph = tools.writeShellApplication {
    name = "opencode-qol-codegraph";
    runtimeInputs = [ tools.nodejs_24 tools.git ];
    text = ''
      exec node --liftoff-only --disable-warning=ExperimentalWarning \
        "${upstreamCodegraph}/lib/codegraph/lib/dist/bin/codegraph.js" "$@"
    '';
  };
  codegraphWithLicense = tools.runCommand "opencode-qol-codegraph-${upstreamCodegraph.version}" { } ''
    mkdir -p "$out/bin" "$out/share/licenses/codegraph"
    ln -s ${lib.getExe codegraph} "$out/bin/codegraph"
    cp ${codegraphLicense} "$out/share/licenses/codegraph/LICENSE"
  '';
  servers = {
    codegraph = {
      type = "local";
      command = [ "${codegraphWithLicense}/bin/codegraph" "serve" "--mcp" ];
      environment = {
        CODEGRAPH_NO_DAEMON = "1";
        CODEGRAPH_NO_UPDATE_CHECK = "1";
      };
    };
    nixos = {
      type = "local";
      command = [ (lib.getExe nixos) ];
    };
  };
in
assert upstreamCodegraph.version == "1.6.2";
assert nixos.version == "3.0.2";
{
  config = tools.writeText "opencode-qol-mcp-servers.json" (builtins.toJSON servers);
  astGrep = tools.ast-grep;
  packages = { codegraph = codegraphWithLicense; inherit nixos; };
  licenses = {
    codegraph = "${codegraphWithLicense}/share/licenses/codegraph/LICENSE";
    nixos = "${nixos}/${tools.python3.sitePackages}/mcp_nixos-${nixos.version}.dist-info/licenses/LICENSE";
  };
  sourceInfo = {
    codegraph = {
      repository = "https://github.com/colbymchenry/codegraph";
      version = upstreamCodegraph.version;
      license = "MIT";
      artifact = { inherit (upstreamCodegraph.src) url outputHash; };
    };
    nixos = {
      repository = "https://github.com/utensils/mcp-nixos";
      version = nixos.version;
      license = "MIT";
      sourceHash = nixos.src.outputHash;
    };
  };
}
