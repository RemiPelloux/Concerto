import { test } from "node:test";
import assert from "node:assert/strict";
import { daysBetween } from "../src/dates.js";

test("a week", () => assert.equal(daysBetween(new Date(2026, 0, 1), new Date(2026, 0, 8)), 7));
