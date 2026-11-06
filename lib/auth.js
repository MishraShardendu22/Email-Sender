import { createHash, timingSafeEqual } from "node:crypto";

// Hashing both sides first gives two buffers of the same length, so
// timingSafeEqual never throws and the time taken does not depend on the
// length of the secret or on how many leading characters match.
function digest(value) {
  return createHash("sha256").update(value, "utf8").digest();
}

// True only when `expected` is a non-empty string equal to `given`. An
// unset secret never matches, so a missing env var cannot turn into
// "undefined === undefined" and let a request through.
export function secretMatches(given, expected) {
  if (typeof expected !== "string" || expected.length === 0) {
    return false;
  }
  return timingSafeEqual(digest(typeof given === "string" ? given : ""), digest(expected));
}
