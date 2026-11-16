{
  description = "Split a coding request into scored user stories and run coding agents on them, each checked and reviewed";

  outputs = { self, nixpkgs }:
    let
      archives = {
        x86_64-linux = { url = "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.1/concerto-linux-x64.tar.gz"; sha256 = "f267def137c933aa751b8ccb9fcadf18b8b6ddb4dfa798cca063389452837839"; };
        aarch64-linux = { url = "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.1/concerto-linux-arm64.tar.gz"; sha256 = "27598fcc19a8f694c97a22a3cf11e3bf870fdc0e5384d362dfba2f1f5bfb007f"; };
        x86_64-darwin = { url = "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.1/concerto-macos-x64.tar.gz"; sha256 = "06e4efed8cb1c7c727c9a2261914588d8d8db22e339588e6bc22fa20c00f2279"; };
        aarch64-darwin = { url = "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.1/concerto-macos-arm64.tar.gz"; sha256 = "4a6e0287b99478b7ff387540471d716b157d3d01543a46187f451d3f9fa8be88"; };
      };
      package = system:
        let pkgs = nixpkgs.legacyPackages.${system};
        in pkgs.stdenvNoCC.mkDerivation {
          pname = "concerto";
          version = "1.0.1";
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
