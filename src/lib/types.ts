// Domain types shared by server, client and pipeline code.
// (Run `npx supabase gen types typescript --local > src/lib/database.types.ts` for full DB typings.)

export const DOC_TYPES = [
  "DISCHARGE_SUMMARY",
  "FINAL_BILL",
  "INVESTIGATION_REPORT",
  "CONSULTATION_PAPER",
  "PHARMACY_BILL",
  "POLICY_COPY",
  "KYC",
  "CANCELLED_CHEQUE",
  "OTHER",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DECISIONS = ["HAVE", "NEED_FROM_PATIENT", "HAVE_BUT_UNCLEAR"] as const;
export type Decision = (typeof DECISIONS)[number];

export const QUERY_STATUSES = [
  "RECEIVED",
  "PROCESSING",
  "SENT",
  "PARTIALLY_SENT",
  "FAILED",
  "NEEDS_REVIEW",
  "RESOLVED",
] as const;
export type QueryStatus = (typeof QUERY_STATUSES)[number];

export type Channel = "WHATSAPP" | "EMAIL";
export type MessageStatus = "DRAFT" | "QUEUED" | "SENDING" | "SENT" | "DELIVERED" | "FAILED" | "SKIPPED";
export type MessageKind = "AUTO" | "CORRECTION" | "RESEND";
export type PipelineStep =
  | "RECEIVED"
  | "READ"
  | "EXTRACT"
  | "MATCH"
  | "REVIEW_GATE"
  | "COMPOSE"
  | "SEND_WHATSAPP"
  | "SEND_EMAIL"
  | "DONE";
export type StepStatus = "STARTED" | "SUCCEEDED" | "FAILED" | "SKIPPED";

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  DISCHARGE_SUMMARY: "Discharge summary",
  FINAL_BILL: "Final bill",
  INVESTIGATION_REPORT: "Investigation report",
  CONSULTATION_PAPER: "Consultation paper",
  PHARMACY_BILL: "Pharmacy bill",
  POLICY_COPY: "Policy copy",
  KYC: "KYC / ID proof",
  CANCELLED_CHEQUE: "Cancelled cheque",
  OTHER: "Other",
};

export interface PatientRow {
  id: string;
  patient_code: string;
  full_name: string;
  insurer: string | null;
  assigned_agent_id: string | null;
  phone_masked: string | null;
  email_masked: string | null;
  policy_masked?: string | null;
  last_activity_at: string;
}

export interface PatientListRow extends PatientRow {
  latest_query_id: string | null;
  latest_query_status: QueryStatus | null;
  latest_query_received_at: string | null;
  document_count: number;
  sort_rank: number;
}

export interface DocumentRow {
  id: string;
  patient_id: string;
  doc_type: DocType;
  file_path: string;
  original_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  extracted_json: Record<string, unknown>;
  doc_date: string | null;
  hospital: string | null;
  amount: number | null;
  confidence: number | null;
  classification_status: "PENDING" | "CLASSIFIED" | "FAILED";
  classification_error: string | null;
  uploaded_at: string;
}

export interface QueryLetterRow {
  id: string;
  patient_id: string;
  file_path: string;
  original_name: string | null;
  status: QueryStatus;
  current_step: PipelineStep;
  last_error: string | null;
  review_reason: string | null;
  claim_ref: string | null;
  insurer_name: string | null;
  needs_correction: boolean;
  page_count: number | null;
  pipeline_ms: number | null;
  received_at: string;
  read_at: string | null;
  analysed_at: string | null;
  sent_at: string | null;
  processed_at: string | null;
  resolved_at: string | null;
}

export interface QueryPointRow {
  id: string;
  query_letter_id: string;
  point_no: number;
  point_text: string;
  insurer_ask: string;
  why_needed: string | null;
  needed_doc_type: DocType | null;
  decision: Decision | null;
  matched_document_id: string | null;
  reason: string | null;
  confidence: number | null;
  needs_review: boolean;
  edited_by_agent: boolean;
  edited_at: string | null;
}

export interface MessageRow {
  id: string;
  patient_id: string;
  query_letter_id: string | null;
  channel: Channel;
  kind: MessageKind;
  revision: number;
  status: MessageStatus;
  to_address: string | null;
  subject: string | null;
  body: string;
  provider_message_id: string | null;
  attempts: number;
  error: string | null;
  created_at: string;
  sent_at: string | null;
  delivered_at?: string | null;
}

export interface QueryEventRow {
  id: number;
  query_letter_id: string;
  step: PipelineStep;
  status: StepStatus;
  attempt: number;
  detail: string | null;
  duration_ms: number | null;
  created_at: string;
}
