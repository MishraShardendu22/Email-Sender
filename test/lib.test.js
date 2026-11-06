import assert from "node:assert/strict";
import { test } from "node:test";

import { bearerToken, secretMatches } from "../lib/auth.js";
import { isSingleAddress, parseCommaList } from "../lib/validate.js";

test("secretMatches compares exact strings and never matches an unset secret", () => {
  assert.equal(secretMatches("abc", "abc"), true);
  assert.equal(secretMatches("abd", "abc"), false);
  assert.equal(secretMatches("abc ", "abc"), false);
  assert.equal(secretMatches("a much longer value", "abc"), false);
  assert.equal(secretMatches(undefined, undefined), false);
  assert.equal(secretMatches("", ""), false);
  assert.equal(secretMatches(undefined, "abc"), false);
  assert.equal(secretMatches(["abc"], "abc"), false);
});

test("bearerToken reads only the Bearer scheme", () => {
  assert.equal(bearerToken("Bearer abc"), "abc");
  assert.equal(bearerToken("bearer abc"), "abc");
  assert.equal(bearerToken("Bearer abc def"), null);
  assert.equal(bearerToken("Basic abc"), null);
  assert.equal(bearerToken("Bearer"), null);
  assert.equal(bearerToken(undefined), null);
});

test("isSingleAddress accepts one plain address only", () => {
  assert.equal(isSingleAddress("me@example.com"), true);
  assert.equal(isSingleAddress("first.last+tag@sub.example.co.uk"), true);
  for (const bad of [
    "",
    "me@example",
    "a@example.com,b@example.com",
    "a@example.com;b@example.com",
    "Me <me@example.com>",
    "me@example.com\r\nBcc: x@example.org",
    "me @example.com",
    `${"a".repeat(250)}@example.com`,
    42,
  ]) {
    assert.equal(isSingleAddress(bad), false, String(bad));
  }
});

test("parseCommaList trims, lowercases and drops empty items", () => {
  assert.deepEqual(parseCommaList(" A@x.com, ,b@Y.com,"), ["a@x.com", "b@y.com"]);
  assert.deepEqual(parseCommaList(undefined), []);
});
