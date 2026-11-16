import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeImpact } from "#src/engine/impact.js";
import { ImportGraph, isTestFile } from "#src/engine/import-graph.js";
import { packageTest } from "#src/engine/package-tests.js";
import { tempDir } from "#tests/fixtures.js";

/** A repository from a map of path to content. */
function repo(files: Record<string, string>): { cwd: string; files: string[] } {
  const cwd = tempDir();
  Object.entries(files).forEach(([path, text]) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  });
  return { cwd, files: Object.keys(files) };
}

const reach = (files: Record<string, string>, changed: string) => {
  const r = repo(files);
  return Object.fromEntries(new ImportGraph(r.cwd, r.files).levels([changed]));
};

describe("import graphs beyond JavaScript and Python", () => {
  it("Go: a package import reaches every file of the package folder; a test sees its own package", () => {
    expect(reach({
      "go.mod": "module example.com/shop\n\ngo 1.22\n",
      "billing/invoice.go": "package billing\n",
      "billing/tax.go": "package billing\n",
      "billing/tax_test.go": "package billing\n",
      "api/handler.go": 'package api\n\nimport (\n\t"fmt"\n\tb "example.com/shop/billing"\n)\n',
    }, "billing/invoice.go")).toEqual({ "billing/tax_test.go": 1, "api/handler.go": 1 });
  });

  it("Rust: `mod` declarations, `use crate::` paths, and another workspace crate by name", () => {
    expect(reach({
      "Cargo.toml": '[workspace]\nmembers = ["core", "cli"]\n',
      "core/Cargo.toml": '[package]\nname = "shop-core"\n',
      "core/src/lib.rs": "pub mod billing;\nmod util;\n",
      "core/src/billing/mod.rs": "pub mod tax;\nuse crate::util::round;\n",
      "core/src/billing/tax.rs": "use super::super::util;\n",
      "core/src/util.rs": "",
      "cli/Cargo.toml": '[package]\nname = "shop-cli"\n',
      "cli/src/main.rs": "use shop_core::billing::tax;\n",
      "core/tests/billing.rs": "use shop_core::billing;\n",
    }, "core/src/util.rs")).toEqual({ "core/src/lib.rs": 1, "core/src/billing/mod.rs": 1, "core/src/billing/tax.rs": 1, "cli/src/main.rs": 2, "core/tests/billing.rs": 2 });
  });

  it("PHP: PSR-4 `use`, grouped `use`, `require __DIR__`, and a class of the same namespace", () => {
    const composer = JSON.stringify({ autoload: { "psr-4": { "Shop\\": "src/" } }, "autoload-dev": { "psr-4": { "Shop\\Tests\\": "tests/" } } });
    expect(reach({
      "composer.json": composer,
      "src/Billing/Tax.php": "<?php\nnamespace Shop\\Billing;\nclass Tax {}\n",
      "src/Billing/Invoice.php": "<?php\nnamespace Shop\\Billing;\nclass Invoice { public function t() { return new Tax(); } }\n",
      "src/Api/Handler.php": "<?php\nnamespace Shop\\Api;\nuse Shop\\Billing\\{Invoice, Tax as T};\n",
      "tests/Billing/InvoiceTest.php": "<?php\nnamespace Shop\\Tests\\Billing;\nuse Shop\\Billing\\Invoice;\n",
      "public/index.php": "<?php\nrequire_once __DIR__ . '/../src/Api/Handler.php';\n",
    }, "src/Billing/Tax.php")).toEqual({ "src/Billing/Invoice.php": 1, "src/Api/Handler.php": 1, "tests/Billing/InvoiceTest.php": 2, "public/index.php": 2 });
  });

  it("Java and Kotlin: imports by package, same-package names, and a test in the same package", () => {
    expect(reach({
      "src/main/java/shop/billing/Tax.java": "package shop.billing;\npublic class Tax {}\n",
      "src/main/java/shop/billing/Invoice.java": "package shop.billing;\nclass Invoice { Tax tax; }\n",
      "src/main/kotlin/shop/api/Handler.kt": "package shop.api\n\nimport shop.billing.Invoice\n",
      "src/test/java/shop/billing/TaxTest.java": "package shop.billing;\nclass TaxTest {}\n",
      "src/main/java/shop/Other.java": "package shop;\nimport shop.billing.*;\n",
    }, "src/main/java/shop/billing/Tax.java")).toEqual({
      "src/main/java/shop/billing/Invoice.java": 1, "src/test/java/shop/billing/TaxTest.java": 1, "src/main/java/shop/Other.java": 1, "src/main/kotlin/shop/api/Handler.kt": 2,
    });
  });

  it("C#: `using` a namespace, and same-namespace names, attributes written without the suffix", () => {
    expect(reach({
      "src/Shop/NotNullAttribute.cs": "namespace Shop.Billing;\npublic class NotNullAttribute {}\n",
      "src/Shop/Tax.cs": "namespace Shop.Billing\n{\n  class Tax { void F([NotNull] object o) {} }\n}\n",
      "src/Shop/Unrelated.cs": "namespace Shop.Other;\nclass Unrelated {}\n",
      "tests/Shop.Tests/TaxTests.cs": "using Shop.Billing;\nnamespace Shop.Tests;\n",
    }, "src/Shop/NotNullAttribute.cs")).toEqual({ "src/Shop/Tax.cs": 1, "tests/Shop.Tests/TaxTests.cs": 1 });
  });

  it("Ruby and Swift: require and require_relative; a SwiftPM target by its import", () => {
    expect(reach({
      "lib/shop.rb": "require 'shop/tax'\n",
      "lib/shop/tax.rb": "",
      "spec/shop/tax_spec.rb": "require_relative '../../lib/shop'\n",
    }, "lib/shop/tax.rb")).toEqual({ "lib/shop.rb": 1, "spec/shop/tax_spec.rb": 2 });
    expect(reach({
      "Sources/Billing/Tax.swift": "struct Tax {}\n",
      "Sources/App/main.swift": "import Foundation\nimport Billing\n",
      "Tests/BillingTests/TaxTests.swift": "import XCTest\n@testable import Billing\n",
    }, "Sources/Billing/Tax.swift")).toEqual({ "Sources/App/main.swift": 1, "Tests/BillingTests/TaxTests.swift": 1 });
  });

  it("knows each language's test files", () => {
    const tests = ["x_test.go", "a/x_spec.rb", "src/test/java/A.java", "FooTest.kt", "src/commonTest/kotlin/Helpers.kt", "Foo.Tests/Bar.cs", "BarTests.cs", "Tests/AppTests/X.swift", "tests/FooTest.php", "features/steps/web.rb"];
    const sources = ["src/main/java/Contest.java", "latest.go", "lib/manifest.rb", "Sources/App/Testing.swift"];
    expect(tests.filter((f) => !isTestFile(f))).toEqual([]);
    expect(sources.filter(isTestFile)).toEqual([]);
  });
});

describe("monorepos and polyglot stories", () => {
  const workspace = {
    "package.json": JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"], scripts: { test: "vitest run" } }),
    "pnpm-lock.yaml": "",
    "packages/ui/package.json": JSON.stringify({ name: "@shop/ui", scripts: { test: "vitest run" } }),
    "packages/ui/src/index.ts": "export * from './button.js';\n",
    "packages/ui/src/button.ts": "export const button = 1;\n",
    "packages/web/package.json": JSON.stringify({ name: "@shop/web" }),
    "packages/web/src/page.ts": "import { button } from '@shop/ui';\nimport { tokens } from '@shop/ui/tokens';\n",
    "packages/ui/src/tokens.ts": "export const tokens = 1;\n",
    "packages/web/src/page.test.ts": "import './page.js';\n",
    "services/billing/go.mod": "module example.com/billing\n",
    "services/billing/tax.go": "package billing\n",
    "services/billing/tax_test.go": "package billing\n",
  };

  it("resolves a workspace package by name, to its src/ folder", () => {
    expect(reach(workspace, "packages/ui/src/button.ts")).toEqual({ "packages/ui/src/index.ts": 1, "packages/web/src/page.ts": 2, "packages/web/src/page.test.ts": 3 });
    expect(reach(workspace, "packages/ui/src/tokens.ts")).toEqual({ "packages/web/src/page.ts": 1, "packages/web/src/page.test.ts": 2 });
  });

  it("scores a story touching TypeScript and Go with the tests of both", async () => {
    const r = repo(workspace);
    const impact = (await analyzeImpact({ cwd: r.cwd, repoFiles: r.files, stories: [{ id: "both", files: ["packages/ui/src/button.ts", "services/billing/tax.go"] }] })).get("both");
    expect(impact?.tests.sort()).toEqual(["packages/web/src/page.test.ts", "services/billing/tax_test.go"]);
    expect(impact?.untested).toBe(0);
  });

  it("runs the tests of the one package a story stays in", () => {
    const r = repo({ ...workspace, "crates/core/Cargo.toml": '[package]\nname = "core"\n', "crates/core/src/lib.rs": "" });
    expect(packageTest(r.cwd, ["packages/ui/src/button.ts", "packages/ui/src/tokens.ts"])).toBe("pnpm --filter @shop/ui test");
    expect(packageTest(r.cwd, ["services/billing/tax.go"])).toBe("go -C services/billing test ./...");
    expect(packageTest(r.cwd, ["crates/core/src/lib.rs"])).toBe("cargo test -p core");
    expect(packageTest(r.cwd, ["packages/web/src/page.ts"])).toBeNull();
    expect(packageTest(r.cwd, ["packages/ui/src/button.ts", "services/billing/tax.go"])).toBeNull();
  });
});
