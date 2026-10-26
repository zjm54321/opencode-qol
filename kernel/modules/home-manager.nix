{ self }:
{ config, lib, pkgs, ... }:
let
  cfg = config.programs.opencode-qol;
  json = pkgs.formats.json { };
  defaults = name: builtins.fromJSON (builtins.readFile (../defaults + "/${name}.json"));
in
{
  options.programs.opencode-qol = {
    enable = lib.mkEnableOption "OpenCode Solution with built-in plugins";
    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      description = "The complete OpenCode package, including its built-in plugins.";
    };
    settings = lib.mkOption {
      type = json.type;
      default = { };
      description = "OpenCode V2 settings merged over the package defaults.";
    };
    slim.settings = lib.mkOption {
      type = json.type;
      default = { };
      description = "OMO Slim settings merged over the package defaults.";
    };
    billionContext.settings = lib.mkOption {
      type = json.type;
      default = { };
      description = "Billion Context settings merged over the package defaults.";
    };
  };

  config = lib.mkIf cfg.enable {
    home.packages = [ cfg.package ];
    xdg.configFile = {
      "opencode/opencode.json".source = json.generate "opencode-qol.json"
        (lib.recursiveUpdate (defaults "opencode") cfg.settings);
      "opencode/oh-my-opencode-slim.json".source = json.generate "opencode-qol-slim.json"
        (lib.recursiveUpdate (defaults "oh-my-opencode-slim") cfg.slim.settings);
      "billion-context/billion-context.json".source = json.generate "opencode-qol-billion-context.json"
        (lib.recursiveUpdate (defaults "billion-context") cfg.billionContext.settings);
    };
  };
}
