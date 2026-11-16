import { test } from "node:test";
import assert from "node:assert/strict";
import { daysBetween } from "../src/dates.js";

test("a week", () => assert.equal(daysBetween(new Date(2026, 0, 1), new Date(2026, 0, 8)), 7));
test("same day, different hours", () => assert.equal(daysBetween(new Date(2026, 4, 3, 1), new Date(2026, 4, 3, 23)), 0));
test("next day, late to early", () => assert.equal(daysBetween(new Date(2026, 4, 3, 23), new Date(2026, 4, 4, 1)), 1));
test("backwards", () => assert.equal(daysBetween(new Date(2026, 0, 8), new Date(2026, 0, 1)), -7));
test("across spring DST", () => assert.equal(daysBetween(new Date(2026, 2, 28), new Date(2026, 2, 30)), 2));
test("across autumn DST", () => assert.equal(daysBetween(new Date(2026, 9, 24), new Date(2026, 9, 27)), 3));
test("a leap year", () => assert.equal(daysBetween(new Date(2028, 0, 1), new Date(2029, 0, 1)), 366));
