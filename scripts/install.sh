#!/bin/sh
# Installs or updates Concerto for the current user:
#   a clean checkout in ~/.local/share/concerto, a `concerto` command in ~/.local/bin,
#   and the Concerto skills for the agents found on this machine (Claude Code, Codex, pi).
# Rerun it to update. Nothing is installed system-wide and no sudo is needed.
set -eu

DIR="${CONCERTO_HOME:-$HOME/.local/share/concerto}"
BIN_DIR="${CONCERTO_BIN_DIR:-$HOME/.local/bin}"
REPO="${CONCERTO_REPO:-https://github.com/RemiPelloux/Concerto.git}"
PNPM_VERSION="10.34.9"

say() { printf '%s\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { say "concerto install: $1 is required." >&2; exit 1; }; }

need git
need node
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || { say "concerto install: Node 22 or newer is required." >&2; exit 1; }

if [ -d "$DIR/.git" ]; then
  say "Updating $DIR"
  git -C "$DIR" pull --ff-only --quiet
else
  say "Cloning into $DIR"
  git clone --quiet --depth 1 "$REPO" "$DIR"
fi

cd "$DIR"
if pnpm --version >/dev/null 2>&1; then PNPM="pnpm"; else PNPM="npx --yes pnpm@$PNPM_VERSION"; fi
$PNPM install --frozen-lockfile --silent
$PNPM run --silent build

mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/concerto" <<EOF
#!/bin/sh
exec node "$DIR/dist/cli.js" "\$@"
EOF
chmod 755 "$BIN_DIR/concerto"
say "Installed $BIN_DIR/concerto"

say "Teaching your agents to use Concerto:"
node "$DIR/dist/cli.js" --install-skills

case ":$PATH:" in
  *":$BIN_DIR:"*) say "Done. Run: concerto --doctor" ;;
  *) say "Done. Add $BIN_DIR to your PATH, then run: concerto --doctor" ;;
esac
