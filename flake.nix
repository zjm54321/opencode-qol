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
  };

  outputs = { self, nixpkgs, opencode, pty-src, ghostty-src }:
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
