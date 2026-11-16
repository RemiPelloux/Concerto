import { test } from "node:test";
import assert from "node:assert/strict";
import { total } from "../src/cart.js";

const item = (sku, price, qty) => ({ sku, price, qty });
test("no code", () => assert.equal(total([item("a", 1000, 1)]), 1499));
test("SAVE10 rounds down", () => assert.equal(total([item("a", 1999, 3)], "SAVE10"), 5397));
test("SAVE10 then shipping", () => assert.equal(total([item("a", 5000, 1)], "SAVE10"), 4500 + 499));
test("FREESHIP", () => assert.equal(total([item("a", 1000, 1)], "FREESHIP"), 1000));
test("BOGO", () => assert.equal(total([item("a", 1000, 5), item("b", 300, 1)], "BOGO-a"), 3000 + 300 + 499));
test("BOGO other sku", () => assert.equal(total([item("b", 1000, 2)], "BOGO-a"), 2000 + 499));
test("unknown", () => assert.throws(() => total([item("a", 1, 1)], "NOPE"), (e) => e instanceof Error && /NOPE/.test(e.message) && /unknown/i.test(e.message)));
