import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../src/slug.js";

test("basic", () => assert.equal(slugify("Hello World"), "hello-world"));
test("accents", () => assert.equal(slugify("Crème Brûlée à Paris"), "creme-brulee-a-paris"));
test("runs of symbols become one dash", () => assert.equal(slugify("a  --  b!!c"), "a-b-c"));
test("no dash at the ends", () => assert.equal(slugify("  ¡Hola! "), "hola"));
test("digits stay", () => assert.equal(slugify("Top 10 of 2026"), "top-10-of-2026"));
test("empty", () => assert.equal(slugify("!!!"), ""));
test("at most 60, cut at a dash", () => {
  const s = slugify("The quick brown fox jumps over the lazy dog and keeps running far away");
  assert.ok(s.length <= 60);
  assert.ok(!s.endsWith("-"));
  assert.ok("the-quick-brown-fox-jumps-over-the-lazy-dog-and-keeps-running-far-away".startsWith(s));
  assert.ok("the-quick-brown-fox-jumps-over-the-lazy-dog-and-keeps-running-far-away"[s.length] === "-");
});
