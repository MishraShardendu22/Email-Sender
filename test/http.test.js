import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { TOKEN, startApp } from "./helpers.js";

describe("HTTP behaviour", () => {
  test("GET / answers that the service runs", async () => {
    const app = await startApp();
    try {
      const res = await app.request("/");
      assert.equal(res.status, 200);
      assert.equal(res.text, "Email Service is running");
      assert.equal(res.headers.get("x-powered-by"), null);
    } finally {
      await app.close();
    }
  });

  test("unknown paths answer 404 JSON", async () => {
    const app = await startApp();
    try {
      const res = await app.request("/nope");
      assert.equal(res.status, 404);
      assert.deepEqual(res.json, { message: "Not found" });
    } finally {
      await app.close();
    }
  });

  test("malformed JSON is a 400 that does not echo the body", async () => {
    const app = await startApp();
    try {
      const res = await app.request("/send-email", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
        raw: '{"subject": "secret-subject-value"',
      });
      assert.equal(res.status, 400);
      assert.deepEqual(res.json, { message: "Request body is not valid JSON" });
    } finally {
      await app.close();
    }
  });

  test("a body over 512 KB is a 400", async () => {
    const app = await startApp();
    try {
      const res = await app.request("/send-email", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
        raw: JSON.stringify({ subject: "s", text: "x".repeat(600 * 1024) }),
      });
      assert.equal(res.status, 400);
      assert.deepEqual(res.json, { message: "Request body is too large" });
    } finally {
      await app.close();
    }
  });

  test("a non-JSON content type is a 400", async () => {
    const app = await startApp();
    try {
      const res = await app.request("/send-email", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "text/plain" },
        raw: "subject=s",
      });
      assert.equal(res.status, 400);
    } finally {
      await app.close();
    }
  });

  test("the send limit answers 429 once exceeded", async () => {
    const app = await startApp({ limits: { send: 2, global: 100 } });
    try {
      assert.equal((await app.sendV2({ subject: "s", text: "t" })).status, 200);
      assert.equal((await app.sendV2({ subject: "s", text: "t" })).status, 200);
      const res = await app.sendV2({ subject: "s", text: "t" });
      assert.equal(res.status, 429);
      assert.equal(app.sent.length, 2);
    } finally {
      await app.close();
    }
  });

  test("failed logins count toward the send limit", async () => {
    const app = await startApp({ limits: { send: 2, global: 100 } });
    try {
      await app.sendV2({ subject: "s", text: "t" }, "wrong");
      await app.sendV2({ subject: "s", text: "t" }, "wrong");
      const res = await app.sendV2({ subject: "s", text: "t" });
      assert.equal(res.status, 429);
      assert.equal(app.sent.length, 0);
    } finally {
      await app.close();
    }
  });
});

describe("CORS", () => {
  const preflight = (app, origin) =>
    app.request("/send-email", {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    });

  test("sends no CORS headers when CORS_ORIGINS is unset", async () => {
    const app = await startApp();
    try {
      const res = await preflight(app, "https://example.org");
      assert.equal(res.headers.get("access-control-allow-origin"), null);
      const post = await app.request("/send-email", {
        method: "POST",
        headers: { origin: "https://example.org", authorization: `Bearer ${TOKEN}` },
        body: { subject: "s", text: "t" },
      });
      assert.equal(post.headers.get("access-control-allow-origin"), null);
    } finally {
      await app.close();
    }
  });

  test("allows only the origins listed in CORS_ORIGINS", async () => {
    const app = await startApp({
      env: { CORS_ORIGINS: "https://site.example.com, https://other.example.com" },
    });
    try {
      const allowed = await preflight(app, "https://site.example.com");
      assert.equal(allowed.headers.get("access-control-allow-origin"), "https://site.example.com");
      assert.match(allowed.headers.get("access-control-allow-headers") ?? "", /Authorization/i);
      const refused = await preflight(app, "https://evil.example.org");
      assert.equal(refused.headers.get("access-control-allow-origin"), null);
    } finally {
      await app.close();
    }
  });
});
