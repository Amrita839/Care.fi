# What you need to run Patient Locker — free setup

**Total cost of this setup: ₹0.** No paid API keys or cards are needed.

Everything in the brief is built, and every service has a free option. This file lists what **you** have to supply, decide or set up,
in the order you'll hit it. ☐ = action for you.

---

## A. On your laptop

| Need | Why | How |
|---|---|---|
| ☐ Node.js 18.18+ (20 LTS recommended) | Run the app and scripts | nodejs.org |
| ☐ Docker Desktop, running | `npx supabase start` runs Postgres/Auth/Storage locally | docker.com |
| ☐ Git + a GitHub repo | Vercel deploys from GitHub | Create an empty repo and push this folder |
| ☐ `psql` (optional) | Run `npm run db:test` (RLS tests) | Comes with Postgres, or use `brew install libpq` |
| ☐ A phone with WhatsApp (or Telegram) | Receive test messages | — |

## B. Free accounts and keys (put them in `.env.local`, then in Vercel)

| # | Service | What to create | Env vars | Free limits / notes |
|---|---|---|---|---|
| 1 | **Supabase** | Local: nothing, `npx supabase start` runs it in Docker. Online: a free project, region **Mumbai (ap-south-1)** | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Free cloud: 2 projects, 500 MB DB, 1 GB files. Pauses after 1 week idle; restore from the dashboard. |
| 2 | **Google Gemini** | Free API key at aistudio.google.com/apikey. No card needed. | `AI_PROVIDER=gemini`, `GEMINI_API_KEY`, `GEMINI_MODEL` | About 15 requests/min on Flash. ⚠️ Free-tier prompts may be used by Google, so use **test data only**. |
| 3 | **Inngest** | Nothing locally (`npm run inngest`). Online: free account, or the Vercel integration | `INNGEST_DEV=1` locally; `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` online | Free plan covers this project. |
| 4 | **WhatsApp** | Pick one: **log** (nothing to create) · **Meta Cloud API test number** (developers.facebook.com) · **Telegram bot** (@BotFather) | `WHATSAPP_PROVIDER` + `META_WA_TOKEN`, `META_WA_PHONE_NUMBER_ID` or `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Meta test number: free, up to 5 verified recipients, token expires after about 24 h, and the recipient must message you first (24-h window). |
| 5 | **Email** | Pick one: **log** · **Gmail SMTP** (App Password) · **Resend free** | `EMAIL_PROVIDER` + `SMTP_*` or `RESEND_API_KEY`, `EMAIL_FROM` | Gmail: about 500/day. Resend: 3,000/month; without a domain it only sends to yourself. |
| 6 | **Vercel** | Free Hobby project linked to your GitHub repo | everything above + `NEXT_PUBLIC_APP_URL` | 60 s per request. Each pipeline step is its own request, so it fits, but very long PDFs may time out. |

Paid services (Claude, Twilio) are still supported with `AI_PROVIDER=anthropic` / `WHATSAPP_PROVIDER=twilio`
if you ever want them. Nothing else changes.

## C. Content and decisions only you can provide

1. ☐ **Official message template.** Paste it into `config/message-template.ts`.
   - Keep the `{{placeholders}}` you need. Settings → Message template shows a live preview.
2. ☐ **How patients send documents back.** ⚠️ This is the main gap. See section E1.
   - The default `SUPPORT_LINE` is deliberately neutral. Change it once you decide.
3. ☐ **Sender identity:**
   - Email "From" name and domain.
   - WhatsApp display name.
   - A support phone number to put in the template.
4. ☐ **Staff list:** who is admin, who is agent, and which patients each agent owns.
   - To create a user: Supabase Auth → Add user, then insert a `staff_users` row.
   - Assign patients with `patients.assigned_agent_id`.
   - There is no staff-admin screen yet. See E3.
5. ☐ **Real patient data import.** Supply patient code, name, phone (E.164, `+91…`), email, policy number and insurer.
   - Patient codes must match `PL-` followed by 6 digits. Change the check in the migration if your IDs differ.
6. ☐ **Auto-send default.** It is ON. You may want it OFF for the first week, so agents approve drafts while you build trust.
7. ☐ **Confidence threshold.** It is 0.6. Change `CONFIDENCE_THRESHOLD` in `src/lib/pipeline/logic.ts`.
8. ☐ **Notify patients when nothing is needed?** Default is no. Set `NOTIFY_WHEN_NOTHING_NEEDED` in the template file.
9. ☐ **Language.** It is English only, as you chose. Hindi or regional languages would need a `preferred_language`
   column and template variants.

## D. Before using REAL patients (not needed for a free demo / college project)

> The free setup is for testing with the fake seed data. Real patient data needs the items below,
> and some of them cost money (free tiers are not meant for confidential health data).

1. ☐ **WhatsApp Business API approval.** The sandbox is test-only. For real patients you need:
   - Meta Business Manager **business verification**.
   - A WhatsApp sender registered through Meta (directly or via a provider).
   - An **approved message template**: WhatsApp only allows free-form text inside 24 hours of the patient messaging
     you, and our first message is business-initiated.
   - **Code change needed:** send your approved template with its variables in
     `src/lib/messaging/providers.ts → sendMeta` (the `META_WA_TEMPLATE` hook is already there). Approval usually takes days.
2. ☐ **Patient consent (DPDP Act 2023).** Record that each patient agreed to be contacted on WhatsApp and email about
   their claim and that their health documents are processed. A `consent_at` column is advisable.
3. ☐ **Vendor data terms.** Health documents are sent to the AI provider (OCR and classification) and stored in Supabase.
   **Do not send real documents to the Gemini free tier**: Google may use free-tier data to improve its products.
   Move to a paid tier whose terms say data isn't used for training, then review and sign each vendor's DPA.
4. ☐ **Data residency.** Keep the Supabase project in Mumbai. Vercel functions can be pinned to `bom1` in project settings.
5. ☐ **Backups and retention.**
   - Enable Supabase PITR (Pro).
   - Decide how long documents and letters are kept, and add a cleanup job.
6. ☐ **Security hygiene:**
   - Turn off public sign-up (already off locally).
   - Enforce strong passwords or MFA for staff in Supabase Auth.
   - Rotate the seeded demo passwords. Never seed production.
7. ☐ **Monitoring.** Set alerts on failed Inngest runs (Inngest has alerting) and on `/api/health`.
   Sentry is optional for app errors.

## E. Things not built yet (not in the brief, but you'll likely want them)

1. **Inbound patient replies.** When a patient replies on WhatsApp or email with photos, nothing saves them to the
   locker automatically. To add it:
   - A Meta (or Telegram) inbound webhook downloads the media and stores it in the patient's folder.
   - It then emits `document/uploaded`. The existing classifier takes over from there.
   - An email inbound route (or Gmail polling) does the same for email.
   - Optionally, re-check open queries afterwards.
2. **Sending answers back to the insurer.** The pipeline tells the patient what's missing. It doesn't compile and send
   the HAVE documents to the insurer or TPA portal.
3. **Admin screens:** create, assign and deactivate staff; create and edit patients; reassign agents.
   Today these are done in Supabase Studio.
4. **Full Supabase TypeScript types.** Run `npx supabase gen types typescript --local > src/lib/database.types.ts`
   and pass the type to the clients for compile-time column checks.
5. **Reminders.** For example, a WhatsApp nudge if nothing arrives in 3 days. This is easy with an Inngest `step.sleep`.
6. **Hindi / regional language** messages.

## F. Acceptance checklist (do these in order)

- ☐ `npm run check` is green (typecheck, lint, 27 unit tests).
- ☐ `npm run setup:local` and `npm run db:test` print **ALL RLS TESTS PASSED**.
- ☐ Logged in as `ravi@…`: 5 patients, Priya first (Needs review); patient PL-100110 not visible.
- ☐ Reveal on a profile shows the real phone and writes `REVEAL_CONTACT` in Settings → audit log.
- ☐ Preview and download of a document work. Opening the copied signed URL after 60 seconds fails.
- ☐ Upload a document: it shows "Classifying" and then the right type chip.
- ☐ Upload query letter PL-100103 (ICICI, the seeded RECEIVED one, or any letter). The Processing view goes green
  step by step in **under 20 seconds**.
- ☐ `npm run e2e` passes 5/5.
- ☐ With `WHATSAPP_PROVIDER=meta` (or `telegram`) and `EMAIL_PROVIDER=smtp` set up, `E2E_SEND=1 … npm run e2e` delivers one WhatsApp/Telegram message and one email per letter.
- ☐ Edit a decision and click "Send corrected message". A revision-1 message appears and the patient gets it.
- ☐ Turn auto-send OFF. A new letter produces drafts and "Approve & send".
- ☐ Break WhatsApp (wrong `META_WA_TOKEN`). Email still goes, the status is PARTIALLY_SENT, and the Messages tab shows the error.
- ☐ Deploy to Vercel (README section 5). `/api/health` returns ok, then repeat one upload in production.
