#!/bin/sh
# Builds the release packages in out/: concerto.tar.gz (Linux, macOS) and concerto.zip (Windows).
# Each holds the files package.json lists plus the production dependencies, all plain JavaScript,
# so one package runs on every platform with Node 22 or newer.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/out"
rm -rf "$OUT"
mkdir -p "$OUT"
cd "$ROOT"
pnpm run --silent build
pnpm pack --pack-destination "$OUT" >/dev/null
tar -xzf "$OUT"/concerto-*.tgz -C "$OUT"
rm "$OUT"/concerto-*.tgz
mv "$OUT/package" "$OUT/concerto"
cp pnpm-lock.yaml "$OUT/concerto/"
# A flat node_modules without symlinks, so the zip unpacks the same on Windows.
(cd "$OUT/concerto" && pnpm install --prod --frozen-lockfile --ignore-scripts --config.node-linker=hoisted --silent && rm pnpm-lock.yaml)
(cd "$OUT" && tar -czf concerto.tar.gz concerto && zip -qr concerto.zip concerto)
printf 'Built %s and %s\n' "$OUT/concerto.tar.gz" "$OUT/concerto.zip"
