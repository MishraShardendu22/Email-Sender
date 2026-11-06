# Email-Sender

A small personal mail sender: an Express app that sends mail through a
Gmail account over SMTP. It runs on Vercel as one function, or locally
with `node index.js`.

It serves two request forms on the same path:

- **Email API v2**: a bearer token, and mail only to the owner's own
  addresses. Use this for anything new.
- **Legacy form**: the original `{email, subject, message, pass1, pass2}`
  body, kept unchanged for existing callers.

Volume is a few mails a day. Gmail's own sending limits apply.

## Email API v2

```
POST /send-email
Authorization: Bearer <SENDER_TOKEN>
Content-Type: application/json

{"subject": "Release v0.1.0", "text": "Plain text body", "html": "<p>Optional HTML body</p>", "to": "optional@example.com"}
```

| Field     | Required | Rules                                                                   |
| --------- | -------- | ----------------------------------------------------------------------- |
| `subject` | yes      | non-empty, one line, at most 200 characters                             |
| `text`    | yes      | non-empty string, at most 200 KB (UTF-8 bytes)                          |
| `html`    | no       | string, at most 200 KB                                                  |
| `to`      | no       | one plain address; defaults to `OWNER_EMAIL`; must be in the allowlist |

The allowlist is `ALLOWED_RECIPIENTS` plus `OWNER_EMAIL`, compared without
regard to letter case. A leaked token can therefore only mail you.

Answers (always JSON `{"message": "..."}`):

| Status | Meaning                                                        |
| ------ | -------------------------------------------------------------- |
| 200    | `{"message": "Email sent successfully"}`                       |
| 400    | bad input: invalid JSON, wrong field type, a limit exceeded    |
| 401    | missing or wrong token, or `SENDER_TOKEN` is not set           |
| 403    | `to` is not in the allowlist                                   |
| 429    | rate limit reached                                             |
| 500    | Gmail refused or failed, or `EMAIL`, `PASS` or `OWNER_EMAIL` is missing |

The token is checked before the body, so a caller without the token
learns nothing about the validation rules.

### curl example

```sh
curl -sS -X POST "https://<your-deployment>.vercel.app/send-email" \
  -H "Authorization: Bearer $EMAIL_SENDER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subject": "Test from curl", "text": "It works."}'
```

## Legacy form

```
POST /send-email
Content-Type: application/json

{"email": "someone@example.org", "subject": "...", "message": "...", "pass1": "<PASS_1>", "pass2": "<PASS_2>"}
```

A request without an `Authorization` header uses this form. It sends to
any single address in `email`, as it always has, because existing callers
(the CloudNative Job Finder services) mail their own users. Answers are
the same as before: 200, 401 `Unauthorized: Invalid credentials`, 500.
New in this version: 400 for invalid input (an `email` holding more than
one address, a subject over 200 characters, a message over 200 KB), and
the form is off when `PASS_1` or `PASS_2` is unset.

Anyone holding `PASS_1` and `PASS_2` can mail any address from your Gmail
account. Use long random values, and unset both once no caller needs the
legacy form.

## Environment variables

| Name                 | Needed for | Description                                                                                                |
| -------------------- | ---------- | ---------------------------------------------------------------------------------------------------------- |
| `EMAIL`              | sending    | Gmail address that sends the mail.                                                                         |
| `PASS`               | sending    | Gmail app password for `EMAIL` (not the account password). Create one at https://myaccount.google.com/apppasswords; it needs 2-Step Verification. |
| `SENDER_TOKEN`       | v2         | Bearer token for v2. Generate with `openssl rand -base64 32`. Unset means v2 answers 401.                  |
| `OWNER_EMAIL`        | v2         | Default recipient, always allowed.                                                                         |
| `ALLOWED_RECIPIENTS` | v2         | Comma list of extra addresses v2 may send to. Default: `OWNER_EMAIL` only.                                 |
| `PASS_1`, `PASS_2`   | legacy     | The two legacy passwords. If either is unset, the legacy form answers 401.                                 |
| `CORS_ORIGINS`       | optional   | Comma list of browser origins allowed to call the API, for example `https://example.com`. Unset means no CORS headers. |
| `PORT`               | local      | Port for `node index.js`. Default 3000. Not used on Vercel.                                                |
| `TRUST_PROXY`        | local      | Proxy hops to trust for the client IP behind your own reverse proxy. Vercel sets this automatically.      |

## CORS

No CORS headers are sent unless `CORS_ORIGINS` is set, for both forms.
The old version allowed every origin. It was removed because the only
callers found are server-side Go services, which do not use CORS, and a
browser caller would have to ship its token or passwords to every
visitor. If you do add a browser caller, list its origin in
`CORS_ORIGINS`.

## Rate limiting and per-request caps

Two in-memory limits per client IP, per 15 minutes: 100 requests of any
kind and 10 calls to `/send-email` (failed logins count). On Vercel the
client IP comes from `X-Forwarded-For`, which Vercel overwrites, so it
cannot be spoofed.

These limits are **best effort on Vercel**. The counters live in one
function instance's memory: a new or recycled instance starts at zero,
and parallel instances each keep their own count. They stop a single
noisy client on a warm instance, not a determined attacker. The real
protection is the token and the recipient allowlist.

What holds on every request no matter which instance serves it:

- one recipient per request (lists, display names and header tricks are refused)
- subject at most 200 characters, `text` and `html` at most 200 KB each, JSON body at most 512 KB
- SMTP connection timeouts of 10 to 20 seconds, so a stuck send ends quickly
- Gmail's own daily sending limit on the account

For a hard limit across instances, add a rate-limit rule for
`/send-email` in the Vercel Firewall, or move the counters to a shared
store such as Redis. Neither is set up here.

## Run locally

Needs Node.js 22 or newer and pnpm.

```sh
pnpm install --frozen-lockfile
cp .env.example .env   # then fill it in
pnpm start             # or: pnpm dev (restarts on change)
```

`node index.js` reads `.env` with Node's built-in `process.loadEnvFile()`
and listens on `PORT`. On Vercel the file is imported instead, so it does
not listen and does not read `.env`.

## Tests

```sh
pnpm test
```

The tests run the real app on a random local port with a fake mail
transport, so they never send mail and need no credentials.

## Deploy on Vercel

Needs the Vercel CLI 47.0.5 or newer (`npm i -g vercel`). Vercel detects
Express with no `vercel.json`: `index.js` imports `express` and
default-exports the app
([Express on Vercel](https://vercel.com/docs/frameworks/backend/express)).

```sh
vercel login
vercel link                                    # pick or create the project

# Each command asks for the value, so it stays out of shell history.
vercel env add EMAIL production
vercel env add PASS production                 # Gmail app password
openssl rand -base64 32                        # copy the output
vercel env add SENDER_TOKEN production         # paste it
vercel env add OWNER_EMAIL production
vercel env add ALLOWED_RECIPIENTS production   # optional
vercel env add PASS_1 production               # legacy callers only
vercel env add PASS_2 production               # legacy callers only

vercel deploy --prod
```

Production variables are stored as secrets by default. Environment
variable changes apply to the next deployment, so deploy again after
changing one. If the project deploys from Git, merging to the production
branch deploys it too.

Then check it:

```sh
curl -sS "https://<your-deployment>.vercel.app/"   # Email Service is running
```

and send yourself a test mail with the curl example above.

## Why not Go

A Go port was considered and not done. The service sends a few mails a
day, so request concurrency and cold-start time do not matter, and the
limit on throughput is Gmail's sending quota, not the runtime. A port
would mean rewriting the code and tests for no gain. Revisit it only if
the service has to send in bulk, and then through a mail provider's API
rather than Gmail SMTP.
