#!/bin/sh
# Wraps the Linux executable in a .deb, for `apt install ./concerto_<version>_<arch>.deb`.
#   sh scripts/packaging/deb.sh out/sea/concerto 0.17.0 amd64 out
set -eu
BIN="$1" VERSION="$2" ARCH="$3" OUT="$4"
STAGE="$(mktemp -d)"
mkdir -p "$STAGE/DEBIAN" "$STAGE/usr/bin"
install -m 755 "$BIN" "$STAGE/usr/bin/concerto"
cat > "$STAGE/DEBIAN/control" <<CONTROL
Package: concerto
Version: $VERSION
Architecture: $ARCH
Maintainer: RemiPelloux <noreply@github.com>
Depends: git
Section: devel
Priority: optional
Homepage: https://github.com/RemiPelloux/Concerto
Description: Split a coding request into scored stories and run coding agents on them
 Concerto scores a request into user stories, routes each to the model that fits it, builds
 each in its own git worktree, checks it with the project's tests and a critic, and merges it.
CONTROL
mkdir -p "$OUT"
dpkg-deb --build --root-owner-group "$STAGE" "$OUT/concerto_${VERSION}_${ARCH}.deb" >/dev/null
rm -rf "$STAGE"
echo "$OUT/concerto_${VERSION}_${ARCH}.deb"
