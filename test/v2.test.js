import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { BASE_ENV, TOKEN, startApp } from "./helpers.js";

describe("Email API v2", () => {
  let app;
  before(async () => {
    app = await startApp({ limits: { send: 1000, global: 1000 } });
  });
  after(() => app.close());

  test("sends to OWNER_EMAIL when to is missing", async () => {
    const before = app.sent.length;
    const res = await app.sendV2({ subject: "Release v0.1.0", text: "notes", html: "<p>notes</p>" });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { message: "Email sent successfully" });
    assert.deepEqual(app.sent[before], {
      from: BASE_ENV.EMAIL,
      to: BASE_ENV.OWNER_EMAIL,
      subject: "Release v0.1.0",
      text: "notes",
      html: "<p>notes</p>",
    });
  });

  test("leaves html out of the mail when it is not given", async () => {
    const before = app.sent.length;
    const res = await app.sendV2({ subject: "s", text: "t" });
    assert.equal(res.status, 200);
    assert.equal("html" in app.sent[before], false);
  });

  test("accepts a recipient from ALLOWED_RECIPIENTS in any letter case", async () => {
    const before = app.sent.length;
    const res = await app.sendV2({ subject: "s", text: "t", to: "alerts@EXAMPLE.com" });
    assert.equal(res.status, 200);
    assert.equal(app.sent[before].to, "alerts@EXAMPLE.com");
  });

  test("refuses a recipient outside the allowlist with 403 and sends nothing", async () => {
    const before = app.sent.length;
    const res = await app.sendV2({ subject: "s", text: "t", to: "stranger@example.org" });
    assert.equal(res.status, 403);
    assert.equal(app.sent.length, before);
  });

  for (const [name, header] of [
    ["a wrong token", `Bearer ${TOKEN}x`],
    ["a shorter token", "Bearer abc"],
    ["another scheme", `Basic ${TOKEN}`],
    ["an empty bearer", "Bearer "],
  ]) {
    test(`answers 401 for ${name} without echoing it`, async () => {
      const before = app.sent.length;
      const res = await app.request("/send-email", {
        method: "POST",
        headers: { authorization: header },
        body: { subject: "s", text: "t" },
      });
      assert.equal(res.status, 401);
      assert.equal(res.text.includes(TOKEN), false);
      assert.equal(app.sent.length, before);
    });
  }

  test("checks the token before validating the body", async () => {
    const res = await app.sendV2({ subject: 5 }, "wrong");
    assert.equal(res.status, 401);
  });

  for (const [name, body] of [
    ["a missing subject", { text: "t" }],
    ["a blank subject", { subject: "   ", text: "t" }],
    ["a subject over 200 characters", { subject: "x".repeat(201), text: "t" }],
    ["a subject with a line break", { subject: "a\r\nBcc: x@example.org", text: "t" }],
    ["a missing text", { subject: "s" }],
    ["an empty text", { subject: "s", text: "" }],
    ["a text over 200 KB", { subject: "s", text: "x".repeat(200 * 1024 + 1) }],
    ["an html over 200 KB", { subject: "s", text: "t", html: "x".repeat(200 * 1024 + 1) }],
    ["a non-string html", { subject: "s", text: "t", html: 1 }],
    ["two recipients in to", { subject: "s", text: "t", to: "owner@example.com,x@example.org" }],
    ["a display-name recipient", { subject: "s", text: "t", to: "Owner <owner@example.com>" }],
  ]) {
    test(`answers 400 for ${name}`, async () => {
      const before = app.sent.length;
      const res = await app.sendV2(body);
      assert.equal(res.status, 400);
      assert.equal(typeof res.json?.message, "string");
      assert.equal(app.sent.length, before);
    });
  }

  test("accepts a subject of exactly 200 characters and a text of exactly 200 KB", async () => {
    const res = await app.sendV2({ subject: "x".repeat(200), text: "y".repeat(200 * 1024) });
    assert.equal(res.status, 200);
  });

  test("answers 400 for a JSON array body", async () => {
    const res = await app.request("/send-email", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
      raw: "[]",
    });
    assert.equal(res.status, 400);
  });

  test("reuses one transport across sends", () => {
    assert.equal(app.transportsCreated(), 1);
  });
});

describe("Email API v2 configuration", () => {
  test("an unset SENDER_TOKEN turns v2 off", async () => {
    const app = await startApp({ env: { SENDER_TOKEN: "" } });
    try {
      const res = await app.sendV2({ subject: "s", text: "t" }, "");
      assert.equal(res.status, 401);
      assert.equal(app.sent.length, 0);
    } finally {
      await app.close();
    }
  });

  test("ALLOWED_RECIPIENTS defaults to OWNER_EMAIL", async () => {
    const app = await startApp({ env: { ALLOWED_RECIPIENTS: undefined } });
    try {
      assert.equal((await app.sendV2({ subject: "s", text: "t" })).status, 200);
      const res = await app.sendV2({ subject: "s", text: "t", to: "alerts@example.com" });
      assert.equal(res.status, 403);
    } finally {
      await app.close();
    }
  });

  test("a missing OWNER_EMAIL with no to is a 500 that names no secret", async () => {
    const app = await startApp({ env: { OWNER_EMAIL: undefined } });
    try {
      const res = await app.sendV2({ subject: "s", text: "t" });
      assert.equal(res.status, 500);
      assert.deepEqual(res.json, { message: "Failed to send email" });
      assert.match(app.logs.join("\n"), /OWNER_EMAIL/);
    } finally {
      await app.close();
    }
  });

  test("a missing EMAIL or PASS is a 500 and no transport is built", async () => {
    const app = await startApp({ env: { PASS: undefined } });
    try {
      const res = await app.sendV2({ subject: "s", text: "t" });
      assert.equal(res.status, 500);
      assert.equal(app.transportsCreated(), 0);
    } finally {
      await app.close();
    }
  });

  test("a send failure is a 500 that does not leak the SMTP error", async () => {
    const failure = Object.assign(new Error(`Invalid login for ${BASE_ENV.PASS}`), {
      code: "EAUTH",
      responseCode: 535,
    });
    const app = await startApp({ failWith: failure });
    try {
      const res = await app.sendV2({ subject: "s", text: "t" });
      assert.equal(res.status, 500);
      assert.deepEqual(res.json, { message: "Failed to send email" });
      const logged = app.logs.join("\n");
      assert.match(logged, /EAUTH/);
      assert.equal(logged.includes(BASE_ENV.PASS), false);
    } finally {
      await app.close();
    }
  });
});
