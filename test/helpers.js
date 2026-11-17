import { createApp } from "../index.js";

export const TOKEN = "test-token-0123456789abcdefghijklmnopqrstuv";

export const BASE_ENV = Object.freeze({
  EMAIL: "sender@example.com",
  PASS: "gmail-app-password",
  SENDER_TOKEN: TOKEN,
  OWNER_EMAIL: "owner@example.com",
  ALLOWED_RECIPIENTS: "owner@example.com,Alerts@Example.com",
  PASS_1: "legacy-one",
  PASS_2: "legacy-two",
});

// Starts the real app on an ephemeral port with a fake transport. Nothing
// leaves the process: sendMail only records the message, or throws
// `failWith` when a test wants a send failure.
export async function startApp({ env = {}, limits, failWith } = {}) {
  const sent = [];
  const logs = [];
  let transportsCreated = 0;
  const app = createApp({
    env: { ...BASE_ENV, ...env },
    limits,
    log: { error: (line) => logs.push(line) },
    createTransport: () => {
      transportsCreated += 1;
      return {
        sendMail: async (mail) => {
          if (failWith) {
            throw failWith;
          }
          sent.push(mail);
          return { messageId: `<${sent.length}@test>` };
        },
      };
    },
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const request = async (path, { method = "GET", headers = {}, body, raw } = {}) => {
    const init = { method, headers: { ...headers } };
    if (raw !== undefined) {
      init.body = raw;
      init.headers["content-type"] ??= "application/json";
    } else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers["content-type"] = "application/json";
    }
    const res = await fetch(base + path, init);
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, headers: res.headers, text, json };
  };

  return {
    sent,
    logs,
    transportsCreated: () => transportsCreated,
    request,
    sendV2: (body, token = TOKEN) =>
      request("/send-email", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body,
      }),
    sendLegacy: (body) => request("/send-email", { method: "POST", body }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
