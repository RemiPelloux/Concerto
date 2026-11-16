{
  description = "Split a coding request into scored user stories and run coding agents on them, each checked and reviewed";

  outputs = { self, nixpkgs }:
    let
      archives = {
        x86_64-linux = { url = "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.2/concerto-linux-x64.tar.gz"; sha256 = "aed0a2cbc41e000498649701883de7b640a7e1d605c9949da3f10f8f7b2fd2ba"; };
        aarch64-linux = { url = "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.2/concerto-linux-arm64.tar.gz"; sha256 = "7da555ddf0e81d1219ad931ec07c9f8c2d1463ffe60da4444631070e5bdc1050"; };
        x86_64-darwin = { url = "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.2/concerto-macos-x64.tar.gz"; sha256 = "69f039f50bb08b1f2cfa64fb78d3401e5c535788713a3bd12da77b35c23e8afb"; };
        aarch64-darwin = { url = "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.2/concerto-macos-arm64.tar.gz"; sha256 = "79696289bf207ebd246f177b4c2345d10b4d6b61de1b7906f8b4313a2f2712a7"; };
      };
      package = system:
        let pkgs = nixpkgs.legacyPackages.${system};
        in pkgs.stdenvNoCC.mkDerivation {
          pname = "concerto";
          version = "1.0.2";
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
