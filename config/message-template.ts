/**
 * ============================================================================
 *  PATIENT MESSAGE TEMPLATE — edit this file to change what patients receive.
 * ============================================================================
 *
 * Paste your official wording below. Keep the {{placeholders}} you need.
 *
 * Available placeholders
 *   {{patient_name}}   Full name, e.g. "Rajesh Kumar Verma"
 *   {{first_name}}     First word of the name, e.g. "Rajesh"
 *   {{patient_code}}   Patient ID, e.g. "PL-100101"
 *   {{insurer}}        Insurer name, e.g. "Star Health"
 *   {{claim_ref}}      Claim number from the letter (or "your claim" if not found)
 *   {{needed_count}}   Number of items needed, e.g. "2"
 *   {{needed_items}}   Numbered list of what to send, one line each, with a short "why"
 *   {{have_items}}     Comma list of things we already have (or empty)
 *   {{review_note}}    Sentence shown only when some points are with our team for checking
 *   {{support_line}}   How to reply (set SUPPORT_LINE below)
 *
 * Lines whose placeholders are all empty are removed automatically,
 * so optional sections disappear cleanly.
 *
 * RULES (enforced in code, not here): document CONTENTS are never put in a message;
 * only document names and simple reasons are used.
 */

// TODO(you): say HOW patients should send documents (inbound WhatsApp/email replies are not auto-saved yet — see REQUIREMENTS.md).
export const SUPPORT_LINE = "Please share the documents with your hospital claims desk, or reply here if you have questions.";

/** One line per needed item. {{n}} = number, {{item}} = what to send, {{why}} = one-line reason. */
export const NEEDED_ITEM_LINE = "{{n}}. {{item}} — {{why}}";

export const WHATSAPP_TEMPLATE = `Hello {{first_name}},

{{insurer}} has asked for {{needed_count}} more document(s) for {{claim_ref}} (Patient ID {{patient_code}}).

Please send:
{{needed_items}}

We already have: {{have_items}}. No need to send these again.

{{review_note}}

{{support_line}}
Thank you.`;

export const EMAIL_SUBJECT = "Documents needed for your claim ({{patient_code}})";

export const EMAIL_TEMPLATE = `Hello {{patient_name}},

{{insurer}} has asked for {{needed_count}} more document(s) for {{claim_ref}} (Patient ID {{patient_code}}).

Please send:
{{needed_items}}

We already have: {{have_items}}. No need to send these again.

{{review_note}}

{{support_line}}

Thank you,
Claims Desk`;

/** Used when every point is already answered from the locker. */
export const NOTHING_NEEDED_TEMPLATE = `Hello {{first_name}},

{{insurer}} had some questions on {{claim_ref}} (Patient ID {{patient_code}}). We already have everything needed and have replied to them. You don't need to do anything.

Thank you.`;

/** Should patients get a message when nothing is needed from them? */
export const NOTIFY_WHEN_NOTHING_NEEDED = false;

/** Put in front of a corrected message sent after an agent changed decisions. */
export const CORRECTION_PREFIX = "Update to our earlier message — please use this list instead.\n\n";

export const REVIEW_NOTE =
  "Our team is checking a few more points and will contact you if anything else is needed.";

/** Simple-language names for each document type (used in {{needed_items}} / {{have_items}}). */
export const SIMPLE_DOC_NAMES: Record<string, string> = {
  DISCHARGE_SUMMARY: "Discharge summary from the hospital",
  FINAL_BILL: "Final hospital bill with item-wise break-up",
  INVESTIGATION_REPORT: "Test reports (blood test, X-ray, scan)",
  CONSULTATION_PAPER: "Doctor's consultation paper",
  PHARMACY_BILL: "Medicine (pharmacy) bills",
  POLICY_COPY: "Insurance policy copy",
  KYC: "ID proof (Aadhaar / PAN)",
  CANCELLED_CHEQUE: "Cancelled cheque with your name printed",
  OTHER: "Document",
};
