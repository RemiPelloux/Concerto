{
  description = "Split a coding request into scored user stories and run coding agents on them, each checked and reviewed";

  outputs = { self, nixpkgs }:
    let
      archives = {
        x86_64-linux = { url = "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.5/concerto-linux-x64.tar.gz"; sha256 = "da65e322efdb3c8fccb56bcda2fb77bb522f2a3bb131461f214aee2e91419bf4"; };
        aarch64-linux = { url = "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.5/concerto-linux-arm64.tar.gz"; sha256 = "81ab80372da797244867d5e33057b6cf074ddac3c76233a87620420877dc36c8"; };
        x86_64-darwin = { url = "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.5/concerto-macos-x64.tar.gz"; sha256 = "63238e57f80c83898936753270230a420e7a4fd5ad41970a0966a7702576f6db"; };
        aarch64-darwin = { url = "https://github.com/RemiPelloux/Concerto/releases/download/v1.0.5/concerto-macos-arm64.tar.gz"; sha256 = "35c4d76606752b38e23882a92bab15618fd8d117406a1cddc89dc0f275185c65"; };
      };
      package = system:
        let pkgs = nixpkgs.legacyPackages.${system};
        in pkgs.stdenvNoCC.mkDerivation {
          pname = "concerto";
          version = "1.0.5";
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
