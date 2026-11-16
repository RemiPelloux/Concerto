/**
 * The import graph on real repositories, one per language, each at a pinned release. For one file
 * of each, the graph must find an importer and a test that a person checked by reading the code.
 *
 *   node --import tsx --conditions=source scripts/language-bench.ts [folder for the clones]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImportGraph, isTestFile } from "#src/engine/import-graph.js";
import { languageOf } from "#src/engine/languages.js";

type Case = { language: string; repo: string; tag: string; file: string; importer: string; test: string };

const KT = "kotlin-result/src/commonMain/kotlin/com/github/michaelbull/result";
const CASES: Case[] = [
  { language: "Go", repo: "spf13/cobra", tag: "v1.8.1", file: "args.go", importer: "doc/md_docs.go", test: "args_test.go" },
  { language: "Rust", repo: "BurntSushi/walkdir", tag: "2.5.0", file: "src/dent.rs", importer: "src/lib.rs", test: "src/tests/recursive.rs" },
  { language: "PHP", repo: "vlucas/phpdotenv", tag: "v5.6.1", file: "src/Parser/Lexer.php", importer: "src/Parser/EntryParser.php", test: "tests/Dotenv/Parser/LexerTest.php" },
  { language: "Java", repo: "jhy/jsoup", tag: "jsoup-1.18.1", file: "src/main/java/org/jsoup/select/QueryParser.java", importer: "src/main/java/org/jsoup/select/Selector.java", test: "src/test/java/org/jsoup/select/QueryParserTest.java" },
  { language: "Kotlin", repo: "michaelbull/kotlin-result", tag: "2.0.0", file: `${KT}/Result.kt`, importer: "kotlin-result-coroutines/src/commonMain/kotlin/com/github/michaelbull/result/coroutines/RunSuspendCatching.kt", test: "kotlin-result/src/commonTest/kotlin/com/github/michaelbull/result/AndTest.kt" },
  { language: "C#", repo: "ardalis/GuardClauses", tag: "v5.0", file: "src/GuardClauses/ValidatedNotNullAttribute.cs", importer: "src/GuardClauses/GuardAgainstNullExtensions.cs", test: "test/GuardClauses.UnitTests/GuardAgainstNull.cs" },
  { language: "Ruby", repo: "jnunemaker/httparty", tag: "v0.22.0", file: "lib/httparty/cookie_hash.rb", importer: "lib/httparty.rb", test: "spec/httparty/cookie_hash_spec.rb" },
  { language: "Swift", repo: "apple/swift-argument-parser", tag: "1.5.0", file: "Sources/ArgumentParser/Parsing/SplitArguments.swift", importer: "Examples/math/Math.swift", test: "Tests/ArgumentParserUnitTests/SplitArgumentTests.swift" },
];

function clone(root: string, c: Case): string {
  const dir = join(root, c.repo.replace("/", "__"), c.tag);
  if (!existsSync(dir)) execFileSync("git", ["clone", "-q", "--depth", "1", "--branch", c.tag, `https://github.com/${c.repo}`, dir], { stdio: "ignore" });
  return dir;
}

/** One row: did the graph find the importer and the test, and how much of the repository has tests. */
function measure(root: string, c: Case): { row: string; ok: boolean } {
  const cwd = clone(root, c);
  const files = execFileSync("git", ["ls-files"], { cwd, encoding: "utf8" }).split("\n").filter(Boolean);
  const started = performance.now();
  const graph = new ImportGraph(cwd, files);
  const ms = Math.round(performance.now() - started);
  const levels = graph.levels([c.file]);
  const [importer, test] = [levels.get(c.importer) === 1, levels.has(c.test)];
  const sources = files.filter((f) => languageOf(f) && !isTestFile(f));
  const tested = sources.filter((f) => graph.dependentsOf([f]).some(isTestFile)).length;
  const mark = (ok: boolean) => (ok ? "yes" : "**no**");
  return { row: `| ${c.language} | ${c.repo}@${c.tag} | \`${c.file}\` | ${mark(importer)} | ${mark(test)} | ${tested}/${sources.length} | ${files.length} | ${ms} ms |`, ok: importer && test };
}

const root = process.argv[2] ?? join(tmpdir(), "concerto-language-bench");
mkdirSync(root, { recursive: true });
const results = CASES.map((c) => measure(root, c));
process.stdout.write(["| Language | Repository | File changed | Importer found | Test found | Sources with a test | Files | Graph built in |", "|---|---|---|---|---|---|---|---|", ...results.map((r) => r.row)].join("\n") + "\n");
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
