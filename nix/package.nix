{
  lib,
  pkgs,
  opencode,
  pluginNodeModules,
  nativePty,
  modelPolicies ? { },
  ...
}:
let
  system = pkgs.stdenv.hostPlatform.system;
  patchedSource = pkgs.applyPatches {
    name = "opencode-qol-upstream-source";
    src = opencode.outPath;
    patches = [ ../patches/nix-persistent-pty.patch ];
  };
  # Keep the official dependency graph and output hash; avoid Bun 1.4.2's
  # streaming download/extraction stall and make fetch failures bounded/visible.
  nodeModules = opencode.packages.${system}.opencode.node_modules.overrideAttrs (old: {
    BUN_FEATURE_FLAG_DISABLE_STREAMING_INSTALL = "1";
    BUN_CONFIG_HTTP_IDLE_TIMEOUT = "45";
    BUN_CONFIG_HTTP_RETRY_COUNT = "2";
    buildPhase = lib.replaceStrings
      [ "--no-progress" ]
      [ "--no-progress --verbose --network-concurrency=8" ]
      old.buildPhase;
  });
  upstream = pkgs.callPackage "${patchedSource}/nix/opencode.nix" {
    node_modules = nodeModules;
  };
  modelPolicy = import ../plugins/model-policy.nix {
    inherit lib pkgs;
    originalProviders = modelPolicies;
  };
  gptTaste = import ../plugins/gpt-taste { inherit lib pkgs; };
  mcpServers = import ./mcp-servers.nix { inherit pkgs; };
in
assert mcpServers.astGrep.version == (builtins.fromJSON (builtins.readFile ../package.json)).dependencies."@ast-grep/cli";
upstream.overrideAttrs (old: {
  pname = "opencode-qol";
  __intentionallyOverridingVersion = true;
  version = (builtins.fromJSON (builtins.readFile "${opencode.outPath}/packages/cli/package.json")).version;
  patches = (old.patches or [ ]) ++ [ ../patches/plugin-resolution.patch ../patches/native-pty-compat.patch ../patches/tui-qol-tools.patch ../patches/qol-branding.patch ];
  doCheck = false;
  doInstallCheck = false;

  postConfigure = (old.postConfigure or "") + ''
    # Replace the platform package payload before CLI build.ts hashes/embeds it.
    # Resolve exactly as the official build helper, and never mutate a store path.
    ptyBinary="$(bun --eval '
      const { createRequire } = require("node:module");
      const { resolve } = require("node:path");
      const core = createRequire(resolve("packages/core/package.json"));
      const pty = createRequire(core.resolve("@opencode-ai/pty/package.json"));
      console.log(pty.resolve("@opencode-ai/pty-linux-" + process.arch + "-gnu/bin/opencode-pty"));
    ')"
    ptyBinary="$(realpath "$ptyBinary")"
    case "$ptyBinary" in
      "$PWD"/*) ;;
      *) echo "PTY helper resolved outside the copied source: $ptyBinary" >&2; exit 1 ;;
    esac
    chmod u+w "$ptyBinary"
    cp ${nativePty}/bin/opencode-pty "$ptyBinary"
    patchelf --set-interpreter ${pkgs.stdenv.cc.bintools.dynamicLinker} \
      --set-rpath ${lib.makeLibraryPath [ pkgs.stdenv.cc.libc pkgs.stdenv.cc.cc.lib ]} "$ptyBinary"
    export QOL_SOURCE_ROOT="$PWD"
    export QOL_ASSET_ROOT="$PWD/.qol-assets"
    export QOL_OUTPUT_ROOT="$out/lib/opencode-qol"
    export QOL_REPOSITORY=${../.}
    export QOL_NODE_MODULES=${pluginNodeModules}
    export QOL_GPT_TASTE=${gptTaste}
    export QOL_MODEL_POLICY=${modelPolicy.package}
    export QOL_MCP_SERVERS_CONFIG=${mcpServers.config}
    export QOL_BUN=${lib.getExe pkgs.bun}
    export QOL_AST_GREP=${lib.getExe mcpServers.astGrep}
    # Builds the checked-in OMO/Billion sources using integrity-locked library
    # inputs before the upstream CLI's static Bun compilation. No npm install.
    node ${./prepare-source.mjs}
  '';

  # Extend upstream's existing wrapper instead of wrapping the binary twice.
  installPhase = lib.replaceStrings [ "wrapProgram $out/bin/opencode" ] [
    "wrapProgram $out/bin/opencode --prefix PATH : ${lib.makeBinPath [ pkgs.bun pkgs.nodejs ]} --set-default OPENCODE_CLEAR_ENCRYPTED_BUN ${lib.getExe pkgs.bun}"
  ] old.installPhase;

  # Keep upstream's native --single --skip-install build and completion
  # generation. This package does not request build/install checks.
  postInstall = ''
    mkdir -p "$out/lib/opencode-qol" "$out/share/opencode-qol"
    mkdir -p "$out/share/licenses" "$out/share/doc"
    cp -R ${nativePty}/share/licenses/opencode-pty-qol "$out/share/licenses/"
    cp -R ${nativePty}/share/doc/opencode-pty-qol "$out/share/doc/"
    mkdir -p "$out/share/licenses/opencode-qol-mcp" "$out/share/doc/opencode-qol-mcp"
    cp ${mcpServers.licenses.codegraph} "$out/share/licenses/opencode-qol-mcp/codegraph-MIT-LICENSE"
    cp ${mcpServers.licenses.nixos} "$out/share/licenses/opencode-qol-mcp/mcp-nixos-MIT-LICENSE"
    cp ${builtins.toFile "opencode-qol-mcp-SOURCES.json" (builtins.toJSON mcpServers.sourceInfo)} "$out/share/doc/opencode-qol-mcp/SOURCES.json"
    cp -a "$QOL_ASSET_ROOT/." "$out/lib/opencode-qol/"
    cp -R ${../defaults} "$out/share/opencode-qol/defaults"
    cp -R ${../assets/branding} "$out/share/opencode-qol/branding"
    cp ${../README.md} "$out/share/opencode-qol/README.md"
    cp ${../LICENSE} "$out/lib/opencode-qol/LICENSE"
    cp ${../THIRD_PARTY_NOTICES.md} "$out/lib/opencode-qol/THIRD_PARTY_NOTICES.md"
    cp ${../package.json} "$out/lib/opencode-qol/package.json"
    cp ${opencode.outPath}/LICENSE "$out/lib/opencode-qol/OPENCODE_LICENSE"
    ln -s ../../lib/opencode-qol/{LICENSE,THIRD_PARTY_NOTICES.md,package.json,plugins,vendor} "$out/share/opencode-qol/"
  '' + (old.postInstall or "");

  passthru = (old.passthru or { }) // {
    inherit modelPolicy nativePty;
    defaults = ../defaults;
  };
  meta = old.meta // {
    description = "OpenCode with source-vendored, statically registered quality-of-life server plugins";
    license = lib.licenses.gpl3Plus;
    platforms = [ "x86_64-linux" ];
  };
})
