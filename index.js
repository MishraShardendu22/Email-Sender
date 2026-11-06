import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import nodemailer from "nodemailer";

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function gmailTransport(env) {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: env.EMAIL, pass: env.PASS },
  });
}

// Builds the app from an env object. Tests pass their own env and a fake
// transport factory, so no real mail is ever sent from a test run.
export function createApp({ env = process.env, createTransport = gmailTransport } = {}) {
  const app = express();
  app.use(express.json());
  app.use(cors());

  app.use(
    rateLimit({
      windowMs: FIFTEEN_MINUTES,
      limit: 100,
      message: { message: "Too many requests, please try again after 15 minutes" },
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  const sendLimiter = rateLimit({
    windowMs: FIFTEEN_MINUTES,
    limit: 10,
    message: { message: "Too many email requests, please try again after 15 minutes" },
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.get("/", (req, res) => {
    res.send("Email Service is running");
  });

  app.post("/send-email", sendLimiter, async (req, res) => {
    const { email, subject, message, pass1, pass2 } = req.body;

    if (pass1 !== env.PASS_1 || pass2 !== env.PASS_2) {
      return res.status(401).json({ message: "Unauthorized: Invalid credentials" });
    }

    try {
      await createTransport(env).sendMail({ from: env.EMAIL, to: email, subject, text: message });
      res.status(200).json({ message: "Email sent successfully" });
    } catch (error) {
      console.error("Error sending email:", error);
      res.status(500).json({ message: "Failed to send email" });
    }
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
