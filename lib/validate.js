export const MAX_SUBJECT_CHARS = 200;
export const MAX_BODY_BYTES = 200 * 1024;
const MAX_ADDRESS_CHARS = 254;

// One plain address, no display name, no list. Commas, semicolons, angle
// brackets, quotes and whitespace are refused so a single request can never
// fan out to several recipients or smuggle a header.
const ADDRESS = /^[^\s@,;<>"'()\\[\]]+@[^\s@,;<>"'()\\[\]]+\.[^\s@,;<>"'()\\[\]]+$/;

export function isSingleAddress(value) {
  return typeof value === "string" && value.length <= MAX_ADDRESS_CHARS && ADDRESS.test(value);
}

export function parseCommaList(value) {
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
}

function checkSubject(subject) {
  if (typeof subject !== "string" || subject.trim().length === 0) {
    return "subject must be a non-empty string";
  }
  if (subject.length > MAX_SUBJECT_CHARS) {
    return `subject must be at most ${MAX_SUBJECT_CHARS} characters`;
  }
  if (/[\r\n]/.test(subject)) {
    return "subject must be a single line";
  }
  return null;
}

function checkBody(name, value, required) {
  if (value === undefined && !required) {
    return null;
  }
  if (typeof value !== "string" || (required && value.length === 0)) {
    return `${name} must be a${required ? " non-empty" : ""} string`;
  }
  if (Buffer.byteLength(value, "utf8") > MAX_BODY_BYTES) {
    return `${name} must be at most ${MAX_BODY_BYTES / 1024} KB`;
  }
  return null;
}

// Email API v2 body: {subject, text, html?, to?}.
export function validateV2(body) {
  return (
    checkSubject(body.subject) ??
    checkBody("text", body.text, true) ??
    checkBody("html", body.html, false) ??
    (body.to !== undefined && !isSingleAddress(body.to) ? "to must be one email address" : null)
  );
}

// Legacy body: {email, subject, message, pass1, pass2}. The message may be
// empty, as before, but it has to be a string when present.
export function validateLegacy(body) {
  if (!isSingleAddress(body.email)) {
    return "email must be one email address";
  }
  return checkSubject(body.subject) ?? checkBody("message", body.message ?? "", false);
}
