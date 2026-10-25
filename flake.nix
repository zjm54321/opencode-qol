{
  description = "OpenCode Solution: pinned OpenCode with built-in quality-of-life plugins";

  inputs = {
    opencode.url = "github:anomalyco/opencode/v2.1.4";
    nixpkgs.follows = "opencode/nixpkgs";
  };

  outputs = { self, nixpkgs, opencode }:
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
      package = import ./nix/package.nix {
        inherit pkgs opencode pluginNodeModules;
        inherit (pkgs) lib;
      };
    in
    {
      packages.${system}.default = package;
      apps.${system}.default = {
        type = "app";
        program = "${package}/bin/opencode";
      };
      homeManagerModules.default = import ./modules/home-manager.nix { inherit self; };
    };
}
