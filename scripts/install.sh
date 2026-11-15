#!/bin/sh
# Installs or updates Concerto for the current user on Linux and macOS:
#   the release package in ~/.local/share/concerto, a `concerto` command in ~/.local/bin,
#   and the Concerto skills for the agents found on this machine (Claude Code, Codex, pi).
# Rerun it to update. Nothing is built and nothing is installed system-wide; no sudo is needed.
# CONCERTO_ARCHIVE installs another package: a URL or a local concerto.tar.gz.
set -eu

DIR="${CONCERTO_HOME:-$HOME/.local/share/concerto}"
BIN_DIR="${CONCERTO_BIN_DIR:-$HOME/.local/bin}"
ARCHIVE="${CONCERTO_ARCHIVE:-https://github.com/RemiPelloux/Concerto/releases/latest/download/concerto.tar.gz}"

say() { printf '%s\n' "$*"; }
fail() { say "concerto install: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is required."; }

need node
need tar
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || fail "Node 22 or newer is required: https://nodejs.org"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
case "$ARCHIVE" in
  http://* | https://*) need curl; say "Downloading $ARCHIVE"; curl -fsSL "$ARCHIVE" -o "$TMP/concerto.tar.gz" ;;
  *) cp "$ARCHIVE" "$TMP/concerto.tar.gz" ;;
esac
tar -xzf "$TMP/concerto.tar.gz" -C "$TMP"
[ -f "$TMP/concerto/dist/cli.js" ] || fail "the package has no dist/cli.js."

# Only ever replace a Concerto install: CONCERTO_HOME pointing anywhere else stops here.
if [ -e "$DIR" ]; then
  grep -q '"name": "concerto"' "$DIR/package.json" 2>/dev/null || fail "$DIR exists and is not a Concerto install."
  rm -rf "$DIR"
fi
mkdir -p "$(dirname "$DIR")"
mv "$TMP/concerto" "$DIR"

mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/concerto" <<EOF
#!/bin/sh
exec node "$DIR/dist/cli.js" "\$@"
EOF
chmod 755 "$BIN_DIR/concerto"
say "Installed $("$BIN_DIR/concerto" --version) in $DIR"

say "Teaching your agents to use Concerto:"
node "$DIR/dist/cli.js" --install-skills

case ":$PATH:" in
  *":$BIN_DIR:"*) say "Done. Run: concerto --doctor" ;;
  *) say "Done. Add $BIN_DIR to your PATH, then run: concerto --doctor" ;;
esac
