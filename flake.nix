{
  description = "Split a coding request into scored user stories and run coding agents on them, each checked and reviewed";

  outputs = { self, nixpkgs }:
    let
      archives = {
        x86_64-linux = { url = "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.3/concerto-linux-x64.tar.gz"; sha256 = "998b1150103410f2b3947683c973f04dd70c0554f92d03ea602bb1332a8f87cd"; };
        aarch64-linux = { url = "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.3/concerto-linux-arm64.tar.gz"; sha256 = "20116dc7e46ef60c87df390c9a8c1d885c025ee8d23d9b90d02f85482030b3ee"; };
        x86_64-darwin = { url = "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.3/concerto-macos-x64.tar.gz"; sha256 = "6afb4d24ac8dbfa7ac8bab0fefb457af30f5f144d8219313cbaf986c7497050d"; };
        aarch64-darwin = { url = "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.3/concerto-macos-arm64.tar.gz"; sha256 = "ce96651d61a5242a8d17ba3c9e45a88d8daba47ebd6f961a7939b129fedcebb0"; };
      };
      package = system:
        let pkgs = nixpkgs.legacyPackages.${system};
        in pkgs.stdenvNoCC.mkDerivation {
          pname = "concerto";
          version = "1.0.3";
          src = pkgs.fetchurl archives.${system};
          sourceRoot = ".";
          dontStrip = true;
          installPhase = "install -Dm755 concerto $out/bin/concerto";
          meta = { description = "Split a coding request into scored user stories and run coding agents on them, each checked and reviewed"; homepage = "https://github.com/RemiPelloux/Concerto"; license = pkgs.lib.licenses.mit; mainProgram = "concerto"; };
        };
    in {
      packages = nixpkgs.lib.genAttrs (builtins.attrNames archives) (system: { default = package system; });
    };
}
