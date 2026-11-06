import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { BASE_ENV, startApp } from "./helpers.js";

const legacyBody = (overrides = {}) => ({
  email: "someone@example.org",
  subject: "New jobs",
  message: "3 new jobs match your search",
  pass1: BASE_ENV.PASS_1,
  pass2: BASE_ENV.PASS_2,
  ...overrides,
});

describe("legacy body form", () => {
  let app;
  before(async () => {
    app = await startApp({ limits: { send: 1000, global: 1000 } });
  });
  after(() => app.close());

  test("still sends to any single address, as existing callers expect", async () => {
    const before = app.sent.length;
    const res = await app.sendLegacy(legacyBody());
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { message: "Email sent successfully" });
    assert.deepEqual(app.sent[before], {
      from: BASE_ENV.EMAIL,
      to: "someone@example.org",
      subject: "New jobs",
      text: "3 new jobs match your search",
    });
  });

  test("still accepts an empty or missing message", async () => {
    assert.equal((await app.sendLegacy(legacyBody({ message: "" }))).status, 200);
    assert.equal((await app.sendLegacy(legacyBody({ message: undefined }))).status, 200);
  });

  for (const [name, overrides] of [
    ["a wrong pass1", { pass1: "nope" }],
    ["a wrong pass2", { pass2: "nope" }],
    ["missing passwords", { pass1: undefined, pass2: undefined }],
    ["non-string passwords", { pass1: 1, pass2: ["legacy-two"] }],
  ]) {
    test(`answers 401 for ${name}`, async () => {
      const res = await app.sendLegacy(legacyBody(overrides));
      assert.equal(res.status, 401);
      assert.deepEqual(res.json, { message: "Unauthorized: Invalid credentials" });
      assert.equal(res.text.includes(BASE_ENV.PASS_1), false);
    });
  }

  for (const [name, overrides] of [
    ["several recipients", { email: "a@example.org,b@example.org" }],
    ["a missing email", { email: undefined }],
    ["a subject over 200 characters", { subject: "x".repeat(201) }],
    ["a message over 200 KB", { message: "x".repeat(200 * 1024 + 1) }],
    ["a non-string message", { message: { html: "x" } }],
  ]) {
    test(`answers 400 for ${name}`, async () => {
      const before = app.sent.length;
      const res = await app.sendLegacy(legacyBody(overrides));
      assert.equal(res.status, 400);
      assert.equal(app.sent.length, before);
    });
  }

  test("a bearer header takes the v2 path even with legacy fields", async () => {
    const res = await app.request("/send-email", {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
      body: legacyBody(),
    });
    assert.equal(res.status, 401);
    assert.deepEqual(res.json, { message: "Unauthorized: Invalid token" });
  });
});

describe("legacy body form without PASS_1 and PASS_2", () => {
  test("is refused, even when the request also omits the passwords", async () => {
    const app = await startApp({ env: { PASS_1: undefined, PASS_2: undefined } });
    try {
      const res = await app.sendLegacy(legacyBody({ pass1: undefined, pass2: undefined }));
      assert.equal(res.status, 401);
      assert.equal(app.sent.length, 0);
    } finally {
      await app.close();
    }
  });
});
