# Import graph benchmark: eight languages on real repositories

Concerto scores a story by what imports the files it changes and which tests cover them. For
JavaScript, TypeScript and Python it reads imports itself or asks SmartTest. Since 0.11 it also
reads Go, Rust, PHP, Java, Kotlin, C#, Ruby and Swift.

This benchmark runs that graph on one real open-source repository per language, each at a pinned
release. For one file of each, a person read the code and recorded a file that really uses it and
a test that really covers it; the graph must find both. Run it again with:

```sh
pnpm bench:languages            # clones into the system temp folder
pnpm bench:languages ~/clones   # or into a folder of your choice
```

It exits non-zero when a case is missed.

## Result

| Language | Repository | File changed | Importer found | Test found | Sources with a test | Files | Graph built in |
|---|---|---|---|---|---|---|---|
| Go | spf13/cobra@v1.8.1 | `args.go` | yes | yes | 19/19 | 66 | 5 ms |
| Rust | BurntSushi/walkdir@2.5.0 | `src/dent.rs` | yes | yes | 4/5 | 19 | 2 ms |
| PHP | vlucas/phpdotenv@v5.6.1 | `src/Parser/Lexer.php` | yes | yes | 39/41 | 95 | 7 ms |
| Java | jhy/jsoup@jsoup-1.18.1 | `src/main/java/org/jsoup/select/QueryParser.java` | yes | yes | 76/81 | 245 | 44 ms |
| Kotlin | michaelbull/kotlin-result@2.0.0 | `kotlin-result/src/commonMain/kotlin/com/github/michaelbull/result/Result.kt` | yes | yes | 21/46 | 78 | 4 ms |
| C# | ardalis/GuardClauses@v5.0 | `src/GuardClauses/ValidatedNotNullAttribute.cs` | yes | yes | 14/15 | 97 | 15 ms |
| Ruby | jnunemaker/httparty@v0.22.0 | `lib/httparty/cookie_hash.rb` | yes | yes | 23/44 | 118 | 2 ms |
| Swift | apple/swift-argument-parser@1.5.0 | `Sources/ArgumentParser/Parsing/SplitArguments.swift` | yes | yes | 45/87 | 194 | 5 ms |

"Sources with a test" counts every source file the graph links to at least one test. What is
left is, on reading, mostly code nothing tests: examples (httparty's `examples/`, the argument
parser's `Examples/`), build scripts (Kotlin's `*.gradle.kts`), tools (`Tools/`, `Plugins/`),
two unused PHP adapters and a binary (`walkdir-list`).

## What each language resolves

| Language | Imports read | Resolved through |
|---|---|---|
| Go | `import "x"`, import blocks | the module path in each `go.mod`; a package is every file of its folder; a `_test.go` file sees its own package |
| Rust | `mod x;`, `use crate::`, `self::`, `super::`, another crate's name | module files (`x.rs`, `x/mod.rs`); crate names from each `Cargo.toml` |
| PHP | `use`, grouped `use`, `require`/`include` | `composer.json` PSR-4 (`autoload` and `autoload-dev`); a class of the same namespace needs no `use` |
| Java, Kotlin | `import`, `import x.*`, `import static` | the `package` each file declares; a class of the same package needs no import; a test sees its own package |
| C# | `using`, `using static`, `global using` | the `namespace` each file declares; `[Name]` also finds `NameAttribute` |
| Ruby | `require`, `require_relative`, `load` | the file's folder, `lib/`, `app/`, then the shortest matching path |
| Swift | `import X`, `@testable import X` | the SwiftPM target folder `Sources/X/` |

Monorepos: a JavaScript workspace package is found by its name (`@acme/ui`, `@acme/ui/button`),
in its `src/` folder first. A story whose files all sit in one package runs that package's tests
(`pnpm --filter`, `yarn workspace`, `npm --workspace`, `cargo test -p`, `go -C <module> test`)
instead of the whole repository's, unless `checks.test` is set.

## Limits

- Kotlin top-level functions are imported by name, not by file: an import that names no file
  links the whole package.
- Same-namespace use is found by name: a capitalised word that names a file of the namespace.
  A comment that mentions a class counts as a use.
- Ruby on Rails autoloading and Swift files of one target seeing each other are not followed.
