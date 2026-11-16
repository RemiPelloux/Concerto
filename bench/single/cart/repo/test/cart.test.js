import { test } from "node:test";
import assert from "node:assert/strict";
import { total } from "../src/cart.js";

test("shipping under 50", () => assert.equal(total([{ sku: "a", price: 1000, qty: 1 }]), 1499));
