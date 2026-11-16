#!/usr/bin/env node
/* global process, URL */
// Writes the package manifests for one release from its version and the SHA-256 of each archive:
//   Formula/concerto.rb (Homebrew, this repository is the tap), bucket/concerto.json (Scoop, this
//   repository is the bucket), flake.nix (Nix), and out/packaging/ with the AUR PKGBUILD and the
//   winget manifests, which are submitted to their own registries.
//
//   node scripts/packaging/render.mjs 0.17.0 out/checksums.txt
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const REPO = "https://github.com/RemiPelloux/Concerto";
const DESC = "Split a coding request into scored user stories and run coding agents on them, each checked and reviewed";
const ARCHIVES = { macArm: "concerto-macos-arm64.tar.gz", macIntel: "concerto-macos-x64.tar.gz", linuxArm: "concerto-linux-arm64.tar.gz", linuxIntel: "concerto-linux-x64.tar.gz", windows: "concerto-windows-x64.zip" };

/** `sha256sum` output: "<hash>  <file>" per line, as a map from file name to hash. */
function checksums(path) {
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  return Object.fromEntries(lines.map((l) => l.trim().split(/\s+\*?/)).map(([hash, file]) => [file.split("/").pop(), hash]));
}

function write(path, text) {
  mkdirSync(dirname(join(ROOT, path)), { recursive: true });
  writeFileSync(join(ROOT, path), text);
}

const url = (v, file) => `${REPO}/releases/download/v${v}/${file}`;

function formula(v, sha) {
  const block = (key) => `      url "${url(v, ARCHIVES[key])}"\n      sha256 "${sha[ARCHIVES[key]]}"`;
  return `class Concerto < Formula
  desc "${DESC}"
  homepage "${REPO}"
  version "${v}"
  license "MIT"

  on_macos do
    on_arm do
${block("macArm")}
    end
    on_intel do
${block("macIntel")}
    end
  end

  on_linux do
    on_arm do
${block("linuxArm")}
    end
    on_intel do
${block("linuxIntel")}
    end
  end

  def install
    bin.install "concerto"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/concerto --version")
  end
end
`;
}

function scoop(v, sha) {
  const autoupdate = { architecture: { "64bit": { url: `${REPO}/releases/download/v$version/${ARCHIVES.windows}` } } };
  return `${JSON.stringify({ version: v, description: DESC, homepage: REPO, license: "MIT", architecture: { "64bit": { url: url(v, ARCHIVES.windows), hash: sha[ARCHIVES.windows] } }, bin: "concerto.exe", checkver: { github: REPO }, autoupdate }, null, 2)}\n`;
}

function flake(v, sha) {
  const systems = { "x86_64-linux": "linuxIntel", "aarch64-linux": "linuxArm", "x86_64-darwin": "macIntel", "aarch64-darwin": "macArm" };
  const entries = Object.entries(systems).map(([system, key]) => `        ${system} = { url = "${url(v, ARCHIVES[key])}"; sha256 = "${sha[ARCHIVES[key]]}"; };`).join("\n");
  return `{
  description = "${DESC}";

  outputs = { self, nixpkgs }:
    let
      archives = {
${entries}
      };
      package = system:
        let pkgs = nixpkgs.legacyPackages.\${system};
        in pkgs.stdenvNoCC.mkDerivation {
          pname = "concerto";
          version = "${v}";
          src = pkgs.fetchurl archives.\${system};
          sourceRoot = ".";
          dontStrip = true;
          installPhase = "install -Dm755 concerto $out/bin/concerto";
          meta = { description = "${DESC}"; homepage = "${REPO}"; license = pkgs.lib.licenses.mit; mainProgram = "concerto"; };
        };
    in {
      packages = nixpkgs.lib.genAttrs (builtins.attrNames archives) (system: { default = package system; });
    };
}
`;
}

function pkgbuild(v, sha) {
  return `# Maintainer: RemiPelloux
pkgname=concerto-bin
pkgver=${v}
pkgrel=1
pkgdesc="${DESC}"
arch=('x86_64' 'aarch64')
url="${REPO}"
license=('MIT')
depends=('git')
provides=('concerto')
options=('!strip')
source_x86_64=("${url(v, ARCHIVES.linuxIntel)}")
source_aarch64=("${url(v, ARCHIVES.linuxArm)}")
sha256sums_x86_64=('${sha[ARCHIVES.linuxIntel]}')
sha256sums_aarch64=('${sha[ARCHIVES.linuxArm]}')

package() {
  install -Dm755 concerto "$pkgdir/usr/bin/concerto"
}
`;
}

function winget(v, sha) {
  const id = "RemiPelloux.Concerto";
  const head = `PackageIdentifier: ${id}\nPackageVersion: ${v}\n`;
  return {
    [`${id}.yaml`]: `${head}DefaultLocale: en-US\nManifestType: version\nManifestVersion: 1.9.0\n`,
    [`${id}.locale.en-US.yaml`]: `${head}PackageLocale: en-US\nPublisher: RemiPelloux\nPackageName: Concerto\nLicense: MIT\nShortDescription: ${DESC}\nPackageUrl: ${REPO}\nManifestType: defaultLocale\nManifestVersion: 1.9.0\n`,
    [`${id}.installer.yaml`]: `${head}InstallerType: zip\nNestedInstallerType: portable\nNestedInstallerFiles:\n  - RelativeFilePath: concerto.exe\n    PortableCommandAlias: concerto\nInstallers:\n  - Architecture: x64\n    InstallerUrl: ${url(v, ARCHIVES.windows)}\n    InstallerSha256: ${sha[ARCHIVES.windows].toUpperCase()}\nManifestType: installer\nManifestVersion: 1.9.0\n`,
  };
}

const [version, sums] = process.argv.slice(2);
if (!version || !sums) throw new Error("usage: render.mjs <version> <checksums file>");
const sha = checksums(sums);
const missing = Object.values(ARCHIVES).filter((a) => !sha[a]);
if (missing.length) throw new Error(`no checksum for ${missing.join(", ")}`);
write("Formula/concerto.rb", formula(version, sha));
write("bucket/concerto.json", scoop(version, sha));
write("flake.nix", flake(version, sha));
write("out/packaging/aur/PKGBUILD", pkgbuild(version, sha));
Object.entries(winget(version, sha)).forEach(([name, text]) => write(`out/packaging/winget/${name}`, text));
process.stdout.write(`Rendered the manifests of ${version}\n`);
