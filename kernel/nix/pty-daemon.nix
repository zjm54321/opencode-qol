{ lib, stdenv, rustPlatform, zig_0_16, cacert, pty-src, ghostty-src }:
let
  # Zig verifies every package against build.zig.zon's content hash. The fixed
  # output hash also locks the complete fetched closure, including lazy deps.
  zigDeps = stdenv.mkDerivation {
    name = "opencode-pty-ghostty-zig-deps";
    src = ghostty-src;
    nativeBuildInputs = [ zig_0_16 cacert ];
    dontConfigure = true;
    dontInstall = true;
    buildPhase = ''
      export ZIG_GLOBAL_CACHE_DIR="$out"
      export HOME="$TMPDIR"
      zig build --help -Demit-lib-vt=true -Demit-xcframework=false -Dapp-runtime=none > /dev/null
      # Zig 0.16 caches dependency archives; --system expects unpacked packages.
      for archive in "$out"/p/*.tar.gz; do
        directory="''${archive%.tar.gz}"
        mkdir -p "$directory"
        tar -xzf "$archive" -C "$directory" --strip-components=1
        rm "$archive"
      done
      rm -rf "$out/b" "$out/o" "$out/h" "$out/z" "$out/tmp"
    '';
    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = "sha256-kJmbTF6VTvd7rZyulDcUZOfl7pYSmflxjp7DxtYorlg=";
  };
  ghosttyVt = stdenv.mkDerivation {
    name = "opencode-pty-ghostty-vt-ab0b9da";
    src = ghostty-src;
    nativeBuildInputs = [ zig_0_16 ];
    dontConfigure = true;
    dontInstall = true;
    buildPhase = ''
      export ZIG_GLOBAL_CACHE_DIR="$TMPDIR/zig-cache"
      zig build --system ${zigDeps}/p -Demit-lib-vt=true -Demit-xcframework=false \
        -Dapp-runtime=none -Doptimize=ReleaseFast -Dcpu=baseline --prefix "$out"
    '';
  };
in rustPlatform.buildRustPackage {
  pname = "opencode-pty-qol";
  version = "0.3.1";
  src = pty-src;
  patches = [ ../patches/native-pty-daemon.patch ];
  cargoHash = "sha256-tki20r+3X3kMNfOcweVVr3wlwnruZ6D1hCxvBslk19o=";
  OPENCODE_GHOSTTY_LIB_DIR = "${ghosttyVt}/lib";
  postInstall = ''
    mkdir -p "$out/share/licenses/opencode-pty-qol" "$out/share/doc/opencode-pty-qol"
    cp ${pty-src}/LICENSE "$out/share/licenses/opencode-pty-qol/opencode-pty-MIT-LICENSE"
    cp ${ghostty-src}/LICENSE "$out/share/licenses/opencode-pty-qol/ghostty-MIT-LICENSE"
    cp ${pty-src}/Cargo.lock ${pty-src}/ghostty-revision "$out/share/doc/opencode-pty-qol/"
    cp ${ghostty-src}/build.zig.zon "$out/share/doc/opencode-pty-qol/ghostty-build.zig.zon"
    cp ${builtins.toFile "opencode-pty-qol-SOURCES.json" (builtins.toJSON {
      daemon = {
        repository = "https://github.com/anomalyco/opencode-pty";
        revision = pty-src.rev;
        version = "0.3.1";
        license = "MIT";
      };
      ghostty = {
        repository = "https://github.com/ghostty-org/ghostty";
        revision = ghostty-src.rev;
        license = "MIT";
      };
      toolchain = { zig = zig_0_16.version; rustc = rustPlatform.rust.rustc.version; };
      modifications = "OpenCode QOL native-pty-daemon.patch; protocol 8, retained tool lifecycle and native timeout support";
    })} "$out/share/doc/opencode-pty-qol/SOURCES.json"
  '';
  # Only the targeted real-actor kill-failure injection checks run here.
  # End-to-end protocol/tool coverage runs against the installed binary.
  doCheck = true;
  cargoTestFlags = [ "--lib" "termination_failure" ];
  meta = { license = lib.licenses.mit; mainProgram = "opencode-pty"; };
}
