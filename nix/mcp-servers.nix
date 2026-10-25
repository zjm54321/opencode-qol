{ pkgs }:
let
  pins = builtins.fromJSON (builtins.readFile ./mcp-sources.json);
  # A separate fixed package set supplies MCP tools without changing OpenCode's
  # toolchain. fetchTree verifies the recorded NAR hash in pure evaluation too.
  toolsSource = builtins.fetchTree pins.nixpkgs;
  tools = import toolsSource.outPath { inherit (pkgs.stdenv.hostPlatform) system; };
  inherit (tools) lib;
  upstreamCodegraph = tools.codegraph;
  nixos = tools.mcp-nixos;
  codegraphLicense = tools.fetchurl pins.codegraph.licenseSource;
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
assert upstreamCodegraph.version == pins.codegraph.version;
assert nixos.version == pins.nixos.version;
assert nixos.src.outputHash == pins.nixos.sourceHash;
{
  config = tools.writeText "opencode-qol-mcp-servers.json" (builtins.toJSON servers);
  astGrep = tools.ast-grep;
  packages = { codegraph = codegraphWithLicense; inherit nixos; };
  licenses = {
    codegraph = "${codegraphWithLicense}/share/licenses/codegraph/LICENSE";
    nixos = "${nixos}/${tools.python3.sitePackages}/mcp_nixos-${nixos.version}.dist-info/licenses/LICENSE";
  };
  sourceInfo = pins // {
    codegraph = pins.codegraph // {
      artifact = { inherit (upstreamCodegraph.src) url outputHash; };
    };
  };
}
