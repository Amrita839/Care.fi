import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import { publicEnv } from "@/lib/env";

/**
 * Message channels — all have a FREE option:
 *   WHATSAPP_PROVIDER = log (default) | meta (WhatsApp Cloud API test number, free) | telegram (free) | twilio
 *   EMAIL_PROVIDER    = log (default) | smtp (e.g. Gmail app password, free) | resend (free tier)
 * `log` sends nothing: the message is stored and shown in the portal, marked as a log delivery.
 */

/** Provider rejected the request for a reason a retry won't fix (bad number, unverified domain, ...). */
export class PermanentSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentSendError";
  }
}

const isPermanent = (status: number) => status >= 400 && status < 500 && status !== 408 && status !== 429;
const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new PermanentSendError(`Missing env var ${k} — see .env.example`);
  return v;
};
const fail = (label: string, status: number, detail: string): never => {
  const msg = `${label} ${status}: ${detail}`.slice(0, 500);
  if (isPermanent(status)) throw new PermanentSendError(msg);
  throw new Error(msg);
};

export interface SendResult {
  providerMessageId: string;
}

export const whatsappProvider = () => (process.env.WHATSAPP_PROVIDER || "log").toLowerCase();
export const emailProvider = () => (process.env.EMAIL_PROVIDER || "log").toLowerCase();

// ================================================================ WhatsApp
export async function sendWhatsApp(opts: { toE164: string; body: string; messageId: string }): Promise<SendResult> {
  const body = opts.body.length > 1550 ? `${opts.body.slice(0, 1540)}…` : opts.body; // WhatsApp limit ~1600 / 4096
  switch (whatsappProvider()) {
    case "log":
      console.info(`[whatsapp:log] to ${opts.toE164.slice(0, 3)}…${opts.toE164.slice(-3)} (${body.length} chars) — not sent`);
      return { providerMessageId: `log-${randomUUID()}` };
    case "meta":
      return sendMeta(opts.toE164, body);
    case "telegram":
      return sendTelegram(body);
    case "twilio":
      return sendTwilio(opts.toE164, body, opts.messageId);
    default:
      throw new PermanentSendError(`Unknown WHATSAPP_PROVIDER "${whatsappProvider()}"`);
  }
}

/**
 * Meta WhatsApp Cloud API (free test number, up to 5 verified recipients).
 * Free-form text is only delivered inside the 24h window after the recipient messaged your number —
 * send "hi" to the test number from your phone first. Outside the window set META_WA_TEMPLATE
 * (e.g. hello_world) to send an approved template instead.
 */
async function sendMeta(toE164: string, body: string): Promise<SendResult> {
  const version = process.env.META_GRAPH_VERSION || "v21.0";
  const template = process.env.META_WA_TEMPLATE;
  const payload = template
    ? { messaging_product: "whatsapp", to: toE164.replace("+", ""), type: "template", template: { name: template, language: { code: process.env.META_WA_TEMPLATE_LANG || "en_US" } } }
    : { messaging_product: "whatsapp", to: toE164.replace("+", ""), type: "text", text: { preview_url: false, body } };
  const res = await fetch(`https://graph.facebook.com/${version}/${need("META_WA_PHONE_NUMBER_ID")}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${need("META_WA_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
  if (!res.ok || !json.messages?.[0]?.id) {
    // 190 = expired token (test tokens last ~24h), 131030 = recipient not in allowed list
    return fail("Meta WhatsApp", res.status, `${json.error?.message ?? "request failed"}${json.error?.code ? ` (code ${json.error.code})` : ""}`);
  }
  return { providerMessageId: json.messages[0].id };
}

/** Telegram bot (free). All messages go to TELEGRAM_CHAT_ID — use it as a free test inbox for "WhatsApp". */
async function sendTelegram(body: string): Promise<SendResult> {
  const res = await fetch(`https://api.telegram.org/bot${need("TELEGRAM_BOT_TOKEN")}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: need("TELEGRAM_CHAT_ID"), text: body }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { message_id: number }; description?: string };
  if (!res.ok || !json.ok) return fail("Telegram", res.status, json.description ?? "request failed");
  return { providerMessageId: `tg-${json.result!.message_id}` };
}

async function sendTwilio(toE164: string, body: string, messageId: string): Promise<SendResult> {
  const sid = need("TWILIO_ACCOUNT_SID");
  const token = need("TWILIO_AUTH_TOKEN");
  const form = new URLSearchParams({ From: need("TWILIO_WHATSAPP_FROM"), To: `whatsapp:${toE164}`, Body: body });
  if (!publicEnv.NEXT_PUBLIC_APP_URL.includes("localhost")) {
    form.set("StatusCallback", `${publicEnv.NEXT_PUBLIC_APP_URL}/api/webhooks/twilio?mid=${messageId}`);
  }
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
  if (!res.ok || !json.sid) return fail("Twilio", res.status, `${json.message ?? "request failed"}${json.code ? ` (${json.code})` : ""}`);
  return { providerMessageId: json.sid };
}

/** Validates X-Twilio-Signature (HMAC-SHA1 over URL + sorted POST params). */
export function verifyTwilioSignature(url: string, params: Record<string, string>, signature: string | null): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!signature || !token) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", token).update(data).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ================================================================ Email
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const toHtml = (body: string) =>
  `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.55;color:#111827;max-width:560px">${escapeHtml(body).split("\n").join("<br>")}</div>`;

let smtp: ReturnType<typeof nodemailer.createTransport> | null = null;

export async function sendEmail(opts: { to: string; subject: string; body: string; idempotencyKey: string }): Promise<SendResult> {
  switch (emailProvider()) {
    case "log":
      console.info(`[email:log] "${opts.subject}" to ${opts.to.slice(0, 2)}…@${opts.to.split("@")[1] ?? ""} — not sent`);
      return { providerMessageId: `log-${randomUUID()}` };

    case "smtp": {
      // Gmail: SMTP_HOST=smtp.gmail.com SMTP_PORT=465 SMTP_USER=you@gmail.com SMTP_PASS=<16-char app password>
      smtp ??= nodemailer.createTransport({
        host: need("SMTP_HOST"),
        port: Number(process.env.SMTP_PORT || 465),
        secure: Number(process.env.SMTP_PORT || 465) === 465,
        auth: { user: need("SMTP_USER"), pass: need("SMTP_PASS") },
      });
      try {
        const info = await smtp.sendMail({
          from: process.env.EMAIL_FROM || need("SMTP_USER"),
          to: opts.to,
          subject: opts.subject,
          text: opts.body,
          html: toHtml(opts.body),
          messageId: `<${opts.idempotencyKey.replace(/[^a-zA-Z0-9.-]/g, ".")}@patient-locker>`,
        });
        return { providerMessageId: info.messageId };
      } catch (e) {
        const err = e as { responseCode?: number; message?: string };
        const code = err.responseCode ?? 0;
        // 5xx SMTP = permanent (bad address / auth); network errors = retry
        if (code >= 500 || /auth|invalid login|535/i.test(err.message ?? "")) throw new PermanentSendError(`SMTP ${code}: ${err.message}`);
        throw new Error(`SMTP: ${err.message}`);
      }
    }

    case "resend": {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${need("RESEND_API_KEY")}`, "Content-Type": "application/json", "Idempotency-Key": opts.idempotencyKey },
        body: JSON.stringify({ from: need("EMAIL_FROM"), to: [opts.to], subject: opts.subject, text: opts.body, html: toHtml(opts.body) }),
        signal: AbortSignal.timeout(15_000),
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
      if (!res.ok || !json.id) return fail("Resend", res.status === 409 ? 500 : res.status, json.message ?? json.name ?? "request failed");
      return { providerMessageId: json.id };
    }
    default:
      throw new PermanentSendError(`Unknown EMAIL_PROVIDER "${emailProvider()}"`);
  }
}
