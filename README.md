# Patient Locker

A DigiLocker-style portal for health-insurance claims. When an insurer's **query letter** is uploaded to a
patient's locker, the system handles it with **no human click**:

1. It reads the letter.
2. It splits the letter into separate points.
3. It checks each point against the documents already in the locker.
4. It messages the patient on **WhatsApp and email** asking only for what's still missing, in simple language.

**Stack (100% free setup):** Next.js 14 (App Router, TS) · Tailwind + shadcn-style components (Radix) ·
Supabase (local via Docker, or the free cloud tier) · Inngest (free dev server) · **Google Gemini free tier**
(vision, JSON output + Zod) · WhatsApp via **Meta Cloud API test number / Telegram / log mode** ·
Email via **Gmail SMTP / Resend free tier / log mode** · Vercel Hobby (free).

Every external service is chosen with one env var. Paid options (Claude, Twilio) still work if you
add them later:

| Need | Free default | Free upgrade | Paid option |
|---|---|---|---|
| AI | `AI_PROVIDER=gemini` | — | `anthropic` |
| WhatsApp | `WHATSAPP_PROVIDER=log` (saved in portal, not sent) | `meta` (test number) or `telegram` | `twilio` |
| Email | `EMAIL_PROVIDER=log` | `smtp` (Gmail) or `resend` | — |
| Database / files / auth | local Supabase | Supabase free cloud project | Supabase Pro |
| Hosting | `npm run dev` | Vercel Hobby | Vercel Pro |

> ⚠️ **Gemini free tier and privacy:** Google may use free-tier prompts to improve its products.
> **Use only the fake seed patients / test documents** on the free tier — never real patient records.

> New here? Read **[REQUIREMENTS.md](REQUIREMENTS.md)** first. It lists every account, key and decision
> you need to go from this repo to production.

## Build status

| Phase | Scope | Status |
|---|---|---|
| 1 | Schema, RLS, private storage, seed, auth | ✅ built, DB tests pass |
| 2 | Portal UI (list, profile, processing view, settings, bulk upload) | ✅ built, screenshots verified in demo mode |
| 3 | Document classification on upload | ✅ built (needs your free Gemini key to run) |
| 4 | Query analysis + matching pipeline (Inngest) | ✅ built, rules unit-tested |
| 5 | WhatsApp + email sending | ✅ built (log mode works with no account; Meta/Telegram/Gmail free) |
| 6 | Reliability + review states | ✅ built, unit-tested |
| 7 | Deploy instructions | ✅ below |

**Not yet run against live services.** The build environment had no access to Supabase's Docker images or to API keys
(the Gemini and Meta request formats are unit-tested with mocked responses).
Run `npm run e2e` (below) once your keys are in. That is the real acceptance test.

---

## 1. Quick look without any backend (demo mode)

```bash
npm install
npm run demo          # http://localhost:3000 – seed data, read-only, no login
```

## 2. Local setup (full stack)

Prerequisites: Node 18.18+, Docker Desktop running, and optionally `psql`.

```bash
npm install
cp .env.example .env.local

# Supabase (local)
npx supabase start                 # copy API URL, anon key, service_role key into .env.local
npm run setup:local                # migrate + seed rows + upload 49 demo files to the private bucket
npm run db:test                    # → ALL RLS TESTS PASSED

# Free Gemini key: https://aistudio.google.com/apikey → put it in GEMINI_API_KEY in .env.local
# WhatsApp/email default to "log" (nothing sent, shown in portal) — see below to send for free

# Run (two terminals)
npm run dev                        # app on :3000
npm run inngest                    # Inngest dev server on :8288 (dashboard: http://localhost:8288)
```

### Demo logins (local seed only)

| Role | Email | Password | Sees |
|---|---|---|---|
| admin | admin@patientlocker.test | Admin@12345 | all 10 patients, Settings |
| agent | ravi@patientlocker.test | Agent@12345 | PL-100101 … PL-100105 |
| agent | neha@patientlocker.test | Agent@12345 | PL-100106 … PL-100109 |

### Running Inngest locally

- `npm run inngest` starts the Inngest Dev Server and points it at `http://localhost:3000/api/inngest`.
- Keep `INNGEST_DEV=1` in `.env.local`. No Inngest keys are needed locally.
- The Inngest dashboard at http://localhost:8288 shows every run, step, retry and error.
  It's the first place to look when a case is stuck.
- The app's own **Processing view** (`/queries/<id>`) shows the same steps live, through Supabase Realtime.

### Free WhatsApp options

**Option A — log mode (default, zero setup).** `WHATSAPP_PROVIDER=log`. Each message is composed and saved,
and you see it in the patient's **Messages** tab labelled *Log only — not delivered*. Use this first.

**Option B — Meta WhatsApp Cloud API test number (free, real WhatsApp).**
1. Go to developers.facebook.com → **My Apps → Create app → Business**, then add the **WhatsApp** product.
2. Open **WhatsApp → API Setup**. You get a free test number.
   - Copy the **Phone number ID** into `META_WA_PHONE_NUMBER_ID`.
   - Copy the **Temporary access token** into `META_WA_TOKEN`. It expires after about 24 hours, so copy it again
     when sends fail with code 190.
3. Under **To**, add and verify your own phone. Up to 5 numbers are allowed.
4. **From that phone, send "hi" to the test number.** This opens the 24-hour window in which free-form messages
   are delivered. Outside the window, set `META_WA_TEMPLATE=hello_world` so the approved sample template is sent instead.
5. Set `WHATSAPP_PROVIDER=meta`, and set a test patient's phone to your number in E.164 format:
   `update patients set phone = '+91XXXXXXXXXX' where patient_code = 'PL-100103';`

**Option C — Telegram bot (free, no approval).** Create a bot with **@BotFather** and copy its token into `TELEGRAM_BOT_TOKEN`.
Send your bot any message, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id` into
`TELEGRAM_CHAT_ID`. Set `WHATSAPP_PROVIDER=telegram`. Every "WhatsApp" message then arrives in your Telegram.

(Twilio is still supported with `WHATSAPP_PROVIDER=twilio` if you ever get an account.)

### Free email options

- `EMAIL_PROVIDER=log`: nothing sent (default).
- **Gmail SMTP (free):**
  1. Turn on 2-Step Verification on the Google account.
  2. Go to myaccount.google.com/apppasswords and create an App Password.
  3. Set `EMAIL_PROVIDER=smtp`, `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER=you@gmail.com`,
     `SMTP_PASS=<16-char app password>` and `EMAIL_FROM="Claims Desk <you@gmail.com>"`.
  4. Gmail allows roughly 500 emails a day.
- **Resend free tier** (3,000 emails a month): `EMAIL_PROVIDER=resend` with `RESEND_API_KEY`. Without a verified
  domain it only delivers to your own sign-up address.

### Gemini free tier tips

- Get a key at https://aistudio.google.com/apikey. No card is needed.
- Model names change over time. The app tries `GEMINI_MODEL`, then each of `GEMINI_FALLBACK_MODELS`, and uses the
  first one your key can access. Your current free models and limits are listed at https://aistudio.google.com/rate-limit.
- The free tier allows roughly 15 requests a minute.
  - Each letter uses about 3 requests and each document 1.
  - On a 429 response the step waits 30 seconds and Inngest retries it.
  - Keep `PIPELINE_CONCURRENCY` / `CLASSIFY_CONCURRENCY` low for bulk uploads. Expect bulk runs to be slower than 20 s per letter.

### End-to-end test (5 sample letters)

```bash
npm run e2e                                                     # drafts only: nothing is sent
E2E_SEND=1 E2E_PHONE=+91XXXXXXXXXX E2E_EMAIL=you@gmail.com npm run e2e   # sends via your WHATSAPP_/EMAIL_PROVIDER
```

It uploads 5 tricky letters and waits for each to finish, then checks the results:
- A 5-point letter.
- "Illegible bills" — an explicit re-request.
- A sideways phone photo.
- A 20-page PDF.
- An empty letter.

For each letter it reports the status, the points, any rule violations, and the time against the 20-second target.

### Other commands

```bash
npm run check          # typecheck + lint + 34 unit tests (rules + Gemini/Meta request formats)
npm run seed:generate  # rebuild supabase/seed.sql from scripts/fixtures/seed-data.ts
npm run db:reset       # wipe + re-migrate + re-seed (then npm run seed:storage)
curl localhost:3000/api/health
```

---

## 3. How the automation works

```
upload (browser → private bucket) ─► query_letters row ─► Inngest event query_letter/received
  start ─► READ (Gemini vision OCR) ─► EXTRACT (points) ─► wait ≤15s for pending classifications
        ─► MATCH (locker metadata only) ─► rules ─► REVIEW GATE ─► COMPOSE (config/message-template.ts)
        ─► SEND_WHATSAPP ‖ SEND_EMAIL (parallel, 3 retries each) ─► DONE (status)
```

- **Each step is its own Inngest step.** Steps are memoised, so a replay skips finished work. Each one is retried 3 times
  with exponential backoff and writes a row to `query_letter_events`. `current_step` and `last_error` show exactly
  where a case stopped.
- **Zod validates every model output.**
  - If validation fails, the model sees the errors and gets one more try.
  - If the second try also fails, the case goes to NEEDS_REVIEW and nothing is sent for that step.
  - Match output must contain exactly one result for each extracted point, with no merges and no inventions.
- **Hard rule, enforced in code as well as the prompt.** The system never asks the patient for a document type that's
  already in the locker, unless the letter says the existing copy is illegible, incomplete, wrong, or needs a fresh,
  clear, original or signed copy. When the rule overrides the model, the point becomes HAVE_BUT_UNCLEAR and is flagged.
- **Review gate:**
  - Points with confidence < 0.6, or marked HAVE_BUT_UNCLEAR, are **never** sent to the patient.
  - The confident points still go out, and the case is marked NEEDS_REVIEW.
- **No double-sends.** Each message row has a unique `idempotency_key` = `<query_letter_id>:<channel>:<revision>`.
  - A retry finds the row already SENT and skips the provider call.
  - Resend also gets the key as `Idempotency-Key`, and SMTP gets a stable `Message-ID`.
  - Corrections and resends get a new revision.
- **One channel failing doesn't stop the other.** The two sends run under `Promise.allSettled`.
  The result is PARTIALLY_SENT (one succeeded) or FAILED (both failed).
- **Auto-send OFF** (Settings): messages are stored as DRAFTs and an "Approve & send" banner appears.
  There is no manual send button in the normal flow.
- **Agent edits:** changing a decision stamps `edited_by_agent`, writes an audit entry and sets `needs_correction`.
  That shows a "Send corrected message" button.
- **Classification on upload:** documents are classified asynchronously by Gemini. The model returns type, date, hospital,
  amount, patient name (with a name-match check), legibility, a one-line summary and short key facts.
  ID and account numbers are redacted.
- **Bad files:**

  | Problem | What happens |
  |---|---|
  | Empty file, blank or tiny image | Rejected, case goes to NEEDS_REVIEW with a clear reason |
  | Encrypted PDF, or more than 100 pages | Same as above |
  | Unsupported type | Same as above |
  | Rotated photo | Auto-rotated from its EXIF data and downscaled |
  | Rotated scan with no EXIF | Read by the model in its correct orientation |
  | Large or many-page PDF | Sent to Gemini natively (up to 100 pages) |

## 4. Privacy and security

- RLS is on for every table. Admins see everything. Agents see only their assigned patients, and anonymous users see
  nothing. `tests/db/rls.test.sql` proves it with 31 checks.
- Phone, email and policy number can't be selected by staff at all (column privileges). Staff see the masked columns.
  `reveal_patient_contact()` returns the real values and always writes an audit row. The UI re-masks after 30 seconds.
- Files sit in one **private** bucket and are only reachable through `/api/files/...`. That route checks RLS, issues a
  **60-second** signed URL, and audits the view or download.
- The audit log covers views, file views and downloads, reveals, decision edits, resends, corrections, uploads and
  settings changes. Audit rows can only be written through `log_audit()`.
- Document contents are never put in messages and never logged. Matching sees only metadata and a one-line summary.
- On the **Gemini free tier**, Google may use prompts to improve its products — use test data only. For real
  patients, switch to a paid tier or provider whose terms you have approved.
- The service-role key is server-only (guarded by `server-only`). It's used only by Inngest functions and by server
  actions after an RLS access check.

## 5. Deploy to Vercel

Free deployment uses Supabase's free cloud project, Vercel Hobby and Inngest's free plan.

1. **Supabase project (free plan):**
   - Create a project in the Mumbai region (`ap-south-1`) to keep data in India.
   - Free projects pause after a week of inactivity; restore them from the dashboard.
   - Run `npx supabase link --project-ref <ref>` and then `npx supabase db push`.
   - Don't run the seed in production. Create staff users in Auth, then insert rows into `staff_users`.
   - Auth → URL configuration: set the Site URL to your Vercel URL.
   - Auth → turn **off** public sign-ups.
2. **Push the repo to GitHub** and import it in Vercel (framework: Next.js).
3. **Environment variables** in Vercel (Production and Preview): everything in `.env.example`.
   - Set `NEXT_PUBLIC_APP_URL=https://<your-app>.vercel.app`.
   - **Remove** `INNGEST_DEV`. Keep `AI_PROVIDER=gemini`, `WHATSAPP_PROVIDER`, `EMAIL_PROVIDER` as you set them locally.
   - `NEXT_PUBLIC_DEMO_MODE` must be unset or `0`.
4. **Inngest:**
   - Install the **Inngest Vercel integration**. It sets `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` and syncs
     `/api/inngest` on every deploy.
   - Without the integration: create the keys in app.inngest.com and add the app URL `https://<app>/api/inngest`.
5. **Function duration:** `/api/inngest` sets `maxDuration = 60`, the free Hobby limit. Each pipeline step is a separate
   request, so normal letters fit easily. Very long PDFs (50+ pages) may time out, and you'd see that in the Processing view.
6. **Twilio (only if you use it):** set the *Status callback* to `https://<app>/api/webhooks/twilio`.
   Meta, Telegram and SMTP don't need a callback; messages show as `SENT`.
7. **Optional:** add a Supabase Database Webhook on INSERT for `query_letters` and `documents`, pointing to
   `https://<app>/api/webhooks/query-letter` with header `x-webhook-secret: $SUPABASE_WEBHOOK_SECRET`.
   This catches rows created outside the portal. Event ids de-duplicate, so nothing runs twice.
8. **Smoke test:**
   - `curl https://<app>/api/health` should return `{"status":"ok"}`.
   - Upload one letter as an agent and watch it in the Processing view.

## 6. Project map

```
config/message-template.ts        ← the ONE file to edit for patient wording
supabase/migrations/*.sql         schema, RLS, storage, realtime, triggers
supabase/seed.sql                 generated demo data
src/inngest/                      process-query-letter, classify-document, send-messages
src/lib/pipeline/logic.ts         hard rule, review gate, template fill, final status (pure, unit-tested)
src/lib/llm/                      Gemini (default) / Claude providers, JSON + Zod retry, prompts, schemas
src/lib/messaging/                WhatsApp (log/meta/telegram/twilio) + email (log/smtp/resend), idempotent send
src/app/(app)/                    patients, patient profile, processing view, settings, bulk upload
src/app/api/                      inngest, files (signed URLs), webhooks, health
tests/db/rls.test.sql             RLS + privacy tests     tests/unit/  rules tests
scripts/e2e.ts                    5-letter end-to-end run
```
