import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const SAMPLES = 5;
const PRECISION = 3;
const TIMEOUT_MS = 10_000;
const cli = resolve(process.argv[2] ?? "dist/cli.js");
const directory = mkdtempSync(join(tmpdir(), "concerto-startup-bench-"));
const env = { ...process.env, PATH: directory, CONCERTO_CONFIG: resolve("concerto.config.json"),
  CONCERTO_CLAUDE_BIN: process.execPath, CONCERTO_CODEX_BIN: "missing-codex", CONCERTO_PI_BIN: "missing-pi",
  PI_AGENT_DIR: directory, XDG_CONFIG_HOME: directory, XDG_CACHE_HOME: directory };

function sample(flag: string): number {
  const output = join(directory, "output");
  const fd = openSync(output, "w");
  try {
    const start = performance.now();
    const result = spawnSync(process.execPath, [cli, flag], {
      cwd: directory, env, timeout: TIMEOUT_MS, stdio: ["ignore", fd, fd],
    });
    const elapsed = performance.now() - start;
    if (result.error) throw result.error;
    assert.equal(result.status, 0, readFileSync(output, "utf8"));
    assert.ok(readFileSync(output, "utf8").length > 0);
    return Number(elapsed.toFixed(PRECISION));
  } finally {
    closeSync(fd);
  }
}

try {
  for (const flag of ["--help", "--doctor", "--models", "--clear-cache"]) {
    sample(flag);
    const samplesMs = Array.from({ length: SAMPLES }, () => sample(flag));
    const ordered = [...samplesMs].sort((a, b) => a - b);
    const medianMs = ordered[Math.floor(SAMPLES / 2)];
    process.stdout.write(`${JSON.stringify({ flag, samplesMs, medianMs })}\n`);
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
