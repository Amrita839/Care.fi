import { Inngest } from "inngest";

/**
 * Locally, run `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest`
 * and set INNGEST_DEV=1. On Vercel, set INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY.
 */
export const inngest = new Inngest({ id: "patient-locker" });

export const EVENTS = {
  queryLetterReceived: "query_letter/received",
  documentUploaded: "document/uploaded",
  sendMessages: "messages/send",
} as const;

export interface QueryLetterReceived {
  queryLetterId: string;
}
export interface DocumentUploaded {
  documentId: string;
}
export interface SendMessagesEvent {
  queryLetterId: string;
  mode: "CORRECTION" | "RESEND" | "APPROVE_DRAFTS";
  actorId: string;
  /** RESEND only */
  messageId?: string;
}
