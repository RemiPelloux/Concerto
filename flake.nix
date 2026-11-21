{
  description = "Split a coding request into scored user stories and run coding agents on them, each checked and reviewed";

  outputs = { self, nixpkgs }:
    let
      archives = {
        x86_64-linux = { url = "https://github.com/RemiPelloux/Concerto/releases/download/v1.1.2/concerto-linux-x64.tar.gz"; sha256 = "b541c21fc5dd835eade1d1196e1742da04b235d3d512bae0410bf299033a6f5f"; };
        aarch64-linux = { url = "https://github.com/RemiPelloux/Concerto/releases/download/v1.1.2/concerto-linux-arm64.tar.gz"; sha256 = "d602b0870c6f7d3753e3c2ad1b1404b6c6e9fe2359431c10b8c2e7eefdc47778"; };
        x86_64-darwin = { url = "https://github.com/RemiPelloux/Concerto/releases/download/v1.1.2/concerto-macos-x64.tar.gz"; sha256 = "32c283ca341ce70074a1abd5905523b352746303c8f460b9f2605e28dcf3d006"; };
        aarch64-darwin = { url = "https://github.com/RemiPelloux/Concerto/releases/download/v1.1.2/concerto-macos-arm64.tar.gz"; sha256 = "440e05841e3305c780bc3818e099d0b2ccc49a78aa9736e7408b0585d88f8c1e"; };
      };
      package = system:
        let pkgs = nixpkgs.legacyPackages.${system};
        in pkgs.stdenvNoCC.mkDerivation {
          pname = "concerto";
          version = "1.1.2";
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
