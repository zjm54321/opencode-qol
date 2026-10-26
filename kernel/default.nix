{ pkgs ? import <nixpkgs> { } }:

let
  system = pkgs.stdenv.hostPlatform.system;
  lock = builtins.fromJSON (builtins.readFile ../flake.lock);
  opencodeNode = lock.nodes.${lock.nodes.root.inputs.opencode};
  fetchLocked = locked: builtins.fetchTarball {
    url = "https://github.com/${locked.owner}/${locked.repo}/archive/${locked.rev}.tar.gz";
    sha256 = locked.narHash;
  };

  # Share the flake's source pins and toolchain, not the caller's package versions.
  opencodeSource = fetchLocked opencodeNode.locked;
  lockedNixpkgs = fetchLocked lock.nodes.${opencodeNode.inputs.nixpkgs}.locked;
  toolchainPkgs = import lockedNixpkgs { inherit system; };
  inherit (toolchainPkgs) lib;
  upstreamNodeModules = toolchainPkgs.callPackage "${opencodeSource}/nix/node_modules.nix" { };

  opencode = {
    outPath = opencodeSource;
    packages.${system}.opencode.node_modules = upstreamNodeModules;
  };

  pluginNodeModules = toolchainPkgs.importNpmLock.buildNodeModules {
    npmRoot = ./.;
    nodejs = toolchainPkgs.nodejs;
    derivationArgs = {
      npmFlags = [ "--ignore-scripts" ];
      doCheck = false;
      doInstallCheck = false;
    };
  };

  package = import ./nix/package.nix {
    inherit lib opencode pluginNodeModules;
    pkgs = toolchainPkgs;
  };
in
assert lib.assertMsg (system == "x86_64-linux") "opencode-qol currently supports x86_64-linux only";
{
  opencode-qol = package;
}
