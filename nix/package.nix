{
  lib,
  pkgs,
  opencode,
  pluginNodeModules,
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
  nodeModules = opencode.packages.${system}.opencode.node_modules;
  upstream = pkgs.callPackage "${patchedSource}/nix/opencode.nix" {
    node_modules = nodeModules;
  };
  modelPolicy = import ../plugins/model-policy.nix {
    inherit lib pkgs;
    originalProviders = modelPolicies;
  };
  gptTaste = import ../plugins/gpt-taste { inherit lib pkgs; };
in
upstream.overrideAttrs (old: {
  pname = "opencode-qol";
  __intentionallyOverridingVersion = true;
  version = (builtins.fromJSON (builtins.readFile "${opencode.outPath}/packages/cli/package.json")).version;
  patches = (old.patches or [ ]) ++ [ ../patches/plugin-resolution.patch ];
  doCheck = false;
  doInstallCheck = false;

  postConfigure = (old.postConfigure or "") + ''
    export QOL_SOURCE_ROOT="$PWD"
    export QOL_ASSET_ROOT="$PWD/.qol-assets"
    export QOL_OUTPUT_ROOT="$out/lib/opencode-qol"
    export QOL_REPOSITORY=${../.}
    export QOL_NODE_MODULES=${pluginNodeModules}
    export QOL_GPT_TASTE=${gptTaste}
    export QOL_MODEL_POLICY=${modelPolicy.package}
    export QOL_BUN=${lib.getExe pkgs.bun}
    export QOL_AST_GREP=${lib.getExe pkgs.ast-grep}
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
    cp -a "$QOL_ASSET_ROOT/." "$out/lib/opencode-qol/"
    cp -R ${../defaults} "$out/share/opencode-qol/defaults"
    cp ${../README.md} "$out/share/opencode-qol/README.md"
    cp ${../LICENSE} ${../THIRD_PARTY_NOTICES.md} ${../package.json} "$out/lib/opencode-qol/"
    cp LICENSE "$out/lib/opencode-qol/OPENCODE_LICENSE"
    ln -s ../../lib/opencode-qol/{LICENSE,THIRD_PARTY_NOTICES.md,package.json,plugins,vendor} "$out/share/opencode-qol/"
  '' + (old.postInstall or "");

  passthru = (old.passthru or { }) // {
    inherit modelPolicy;
    defaults = ../defaults;
  };
  meta = old.meta // {
    description = "OpenCode with source-vendored, statically registered quality-of-life server plugins";
    license = lib.licenses.gpl3Plus;
    platforms = [ "x86_64-linux" ];
  };
})
