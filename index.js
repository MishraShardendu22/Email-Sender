import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import nodemailer from "nodemailer";

import { bearerToken, secretMatches } from "./lib/auth.js";
import { isSingleAddress, parseCommaList, validateLegacy, validateV2 } from "./lib/validate.js";

const FIFTEEN_MINUTES = 15 * 60 * 1000;
// Room for a 200 KB text part, a 200 KB html part and the JSON around them.
const JSON_BODY_LIMIT = "512kb";

function gmailTransport(env) {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: env.EMAIL, pass: env.PASS },
    // Fail fast instead of holding a serverless invocation open.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

function trustProxySetting(env) {
  // Vercel overwrites X-Forwarded-For with the client address, so one
  // trusted hop gives the rate limiter the real client IP there.
  if (env.VERCEL) {
    return 1;
  }
  const hops = Number.parseInt(env.TRUST_PROXY ?? "", 10);
  return Number.isInteger(hops) && hops > 0 ? hops : false;
}

function limiter(limit, message) {
  return rateLimit({
    windowMs: FIFTEEN_MINUTES,
    limit,
    message: { message },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

// Logs what failed without the error object itself, which can carry SMTP
// transcripts or request data.
function logSendFailure(log, error) {
  const code = error?.code ?? "unknown";
  const response = error?.responseCode ? ` (SMTP ${error.responseCode})` : "";
  log.error(`Error sending email: ${code}${response}`);
}

// Builds the app from an env object. Tests pass their own env and a fake
// transport factory, so no real mail is ever sent from a test run.
export function createApp({
  env = process.env,
  createTransport = gmailTransport,
  limits = {},
  log = console,
} = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", trustProxySetting(env));

  // No CORS headers unless CORS_ORIGINS names the browser origins allowed
  // to call the API. Server-side callers do not need CORS at all.
  const corsOrigins = parseCommaList(env.CORS_ORIGINS);
  if (corsOrigins.length > 0) {
    app.use(
      cors({
        origin: corsOrigins,
        methods: ["GET", "POST"],
        allowedHeaders: ["Content-Type", "Authorization"],
        maxAge: 600,
      }),
    );
  }

  app.use(limiter(limits.global ?? 100, "Too many requests, please try again after 15 minutes"));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  const sendLimiter = limiter(
    limits.send ?? 10,
    "Too many email requests, please try again after 15 minutes",
  );

  let transport;
  const getTransport = () => {
    transport ??= createTransport(env);
    return transport;
  };

  // Recipients a v2 request may name: ALLOWED_RECIPIENTS plus OWNER_EMAIL.
  // A leaked token can then only mail the owner's own addresses.
  const ownerEmail = (env.OWNER_EMAIL ?? "").trim();
  const allowedRecipients = new Set(parseCommaList(env.ALLOWED_RECIPIENTS));
  if (isSingleAddress(ownerEmail)) {
    allowedRecipients.add(ownerEmail.toLowerCase());
  }

  const v2Mail = (token, body) => {
    if (!secretMatches(token ?? "", env.SENDER_TOKEN)) {
      return { status: 401, message: "Unauthorized: Invalid token" };
    }
    const invalid = validateV2(body);
    if (invalid) {
      return { status: 400, message: invalid };
    }
    const to = body.to ?? ownerEmail;
    if (!isSingleAddress(to)) {
      log.error("Error sending email: OWNER_EMAIL is not set or not one address");
      return { status: 500, message: "Failed to send email" };
    }
    if (!allowedRecipients.has(to.toLowerCase())) {
      return { status: 403, message: "Forbidden: recipient is not allowed" };
    }
    const mail = { to, subject: body.subject, text: body.text };
    if (body.html !== undefined) {
      mail.html = body.html;
    }
    return { mail };
  };

  const legacyMail = (body) => {
    // Both checks always run so the response time does not show which
    // password was wrong.
    const pass1Ok = secretMatches(body.pass1, env.PASS_1);
    const pass2Ok = secretMatches(body.pass2, env.PASS_2);
    if (!(pass1Ok && pass2Ok)) {
      return { status: 401, message: "Unauthorized: Invalid credentials" };
    }
    const invalid = validateLegacy(body);
    if (invalid) {
      return { status: 400, message: invalid };
    }
    return { mail: { to: body.email, subject: body.subject, text: body.message ?? "" } };
  };

  app.get("/", (req, res) => {
    res.send("Email Service is running");
  });

  app.post("/send-email", sendLimiter, async (req, res) => {
    const body = req.body;
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({ message: "Request body must be a JSON object" });
    }

    // A request with an Authorization header is Email API v2; one without
    // it is the legacy body form. The legacy callers never send the header.
    const authorization = req.get("authorization");
    const result =
      authorization === undefined ? legacyMail(body) : v2Mail(bearerToken(authorization), body);
    if (result.status) {
      return res.status(result.status).json({ message: result.message });
    }
    const mail = result.mail;

    if (!env.EMAIL || !env.PASS) {
      log.error("Error sending email: EMAIL or PASS is not set");
      return res.status(500).json({ message: "Failed to send email" });
    }
    try {
      await getTransport().sendMail({ from: env.EMAIL, ...mail });
      return res.status(200).json({ message: "Email sent successfully" });
    } catch (error) {
      logSendFailure(log, error);
      return res.status(500).json({ message: "Failed to send email" });
    }
  });

  app.use((req, res) => {
    res.status(404).json({ message: "Not found" });
  });

  // Body parser errors (bad JSON, body too large) become a plain 400; the
  // default handler would print a stack trace and echo parser details.
  app.use((error, req, res, next) => {
    if (res.headersSent) {
      return next(error);
    }
    if (error?.type === "entity.parse.failed") {
      return res.status(400).json({ message: "Request body is not valid JSON" });
    }
    if (error?.type === "entity.too.large") {
      return res.status(400).json({ message: "Request body is too large" });
    }
    if (typeof error?.status === "number" && error.status >= 400 && error.status < 500) {
      return res.status(400).json({ message: "Bad request" });
    }
    log.error(`Unhandled error: ${error?.name ?? "unknown"}`);
    return res.status(500).json({ message: "Internal server error" });
  });

  return app;
}

// Vercel imports this module and serves the default export; it never runs
// it as a script. `node index.js` (and nodemon) run it as a script, which
// is the only case that reads .env and opens a port.
const runAsScript =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const listenLocally = runAsScript && !process.env.VERCEL;

if (listenLocally) {
  try {
    process.loadEnvFile();
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

const app = createApp();
export default app;

if (listenLocally) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log(`Email service running on port ${port}`);
  });
}
