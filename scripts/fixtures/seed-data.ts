/**
 * Single source of truth for demo data.
 *  - scripts/generate-seed.ts  -> writes supabase/seed.sql from this file
 *  - scripts/seed-storage.ts   -> renders a PDF for every document / letter and uploads it
 * All people, phone numbers, hospitals and policy numbers are FICTIONAL.
 */

export type DocType =
  | "DISCHARGE_SUMMARY"
  | "FINAL_BILL"
  | "INVESTIGATION_REPORT"
  | "CONSULTATION_PAPER"
  | "PHARMACY_BILL"
  | "POLICY_COPY"
  | "KYC"
  | "CANCELLED_CHEQUE"
  | "OTHER";

export const uid = (prefix: string, n: number) =>
  `00000000-0000-4000-8000-${prefix}${String(n).padStart(12 - prefix.length, "0")}`;

export interface StaffSeed {
  id: string;
  email: string;
  password: string;
  full_name: string;
  role: "admin" | "agent";
}

export const STAFF: StaffSeed[] = [
  { id: uid("1", 1), email: "admin@patientlocker.test", password: "Admin@12345", full_name: "Asha Mehta", role: "admin" },
  { id: uid("1", 2), email: "ravi@patientlocker.test", password: "Agent@12345", full_name: "Ravi Kumar", role: "agent" },
  { id: uid("1", 3), email: "neha@patientlocker.test", password: "Agent@12345", full_name: "Neha Sharma", role: "agent" },
];

export interface DocSeed {
  id: string;
  type: DocType;
  name: string; // original file name
  date: string; // ISO date
  hospital: string | null;
  amount: number | null;
  confidence: number;
  facts: Record<string, string | number | boolean>; // classifier key facts (no full text)
  body: string[]; // synthetic content rendered into the demo PDF
}

export interface PatientSeed {
  id: string;
  code: string;
  full_name: string;
  phone: string;
  email: string;
  policy_number: string;
  insurer: string;
  agent: string | null; // staff id
  docs: DocSeed[];
}

const H = {
  sunrise: "Sunrise Multispeciality Hospital, Gurugram",
  lotus: "Lotus Heart & Vascular Centre, New Delhi",
  ganga: "Ganga Care Hospital, Lucknow",
  deccan: "Deccan Medical Institute, Hyderabad",
  coastal: "Coastal Life Hospital, Kochi",
  western: "Western Ghats Hospital, Pune",
  sahyadri: "Sahyadri City Hospital, Bengaluru",
};

let docCounter = 0;
const d = (
  type: DocType,
  name: string,
  date: string,
  hospital: string | null,
  amount: number | null,
  confidence: number,
  facts: DocSeed["facts"],
  body: string[],
): DocSeed => ({ id: uid("3", ++docCounter), type, name, date, hospital, amount, confidence, facts, body });

export const PATIENTS: PatientSeed[] = [
  {
    id: uid("2", 1), code: "PL-100101", full_name: "Rajesh Kumar Verma", phone: "+919811000101",
    email: "rajesh.verma@example.com", policy_number: "SH-2025-88310457", insurer: "Star Health",
    agent: uid("1", 2),
    docs: [
      d("DISCHARGE_SUMMARY", "discharge_summary_rajesh.pdf", "2026-09-18", H.sunrise, null, 0.97,
        { diagnosis: "Acute calculous cholecystitis", procedure: "Laparoscopic cholecystectomy", admission_date: "2026-09-15", discharge_date: "2026-09-18", treating_doctor: "Dr. Anil Kapoor" },
        ["Diagnosis: Acute calculous cholecystitis", "Procedure: Laparoscopic cholecystectomy on 16-09-2026", "Admitted 15-09-2026, discharged 18-09-2026 in stable condition", "Treating surgeon: Dr. Anil Kapoor, MS"]),
      d("FINAL_BILL", "final_bill_IP2609151.pdf", "2026-09-18", H.sunrise, 148750, 0.95,
        { bill_no: "IP2609151", itemised: true, room_category: "Single private" },
        ["Bill No: IP2609151", "Room rent (3 days, single private): 18,000", "OT & surgeon charges: 72,500", "Medicines & consumables: 41,250", "Investigations: 17,000", "Net payable: Rs 1,48,750"]),
      d("INVESTIGATION_REPORT", "usg_abdomen_15sep.pdf", "2026-09-15", H.sunrise, null, 0.93,
        { test: "USG whole abdomen", finding: "Multiple gall bladder calculi, wall thickening" },
        ["USG Whole Abdomen", "Impression: Multiple calculi in gall bladder with wall thickening, suggestive of acute cholecystitis"]),
      d("POLICY_COPY", "star_health_policy.pdf", "2025-11-02", null, null, 0.98,
        { policy_number: "SH-2025-88310457", sum_insured: 500000, valid_till: "2026-11-01" },
        ["Policy No: SH-2025-88310457", "Sum insured: Rs 5,00,000", "Period: 02-11-2025 to 01-11-2026"]),
      d("KYC", "aadhaar_masked.pdf", "2024-03-10", null, null, 0.96,
        { id_kind: "Aadhaar", id_last4: "4821", name_matches: true },
        ["Aadhaar (masked): XXXX XXXX 4821", "Name: Rajesh Kumar Verma"]),
    ],
  },
  {
    id: uid("2", 2), code: "PL-100102", full_name: "Priya Nair", phone: "+919811000102",
    email: "priya.nair@example.com", policy_number: "HE-4410-2290-7781", insurer: "HDFC ERGO",
    agent: uid("1", 2),
    docs: [
      d("DISCHARGE_SUMMARY", "DS_priya_nair.pdf", "2026-10-04", H.coastal, null, 0.96,
        { diagnosis: "Dengue fever with thrombocytopenia", admission_date: "2026-09-30", discharge_date: "2026-10-04", treating_doctor: "Dr. Meera Thomas" },
        ["Diagnosis: Dengue fever (NS1 positive) with thrombocytopenia", "Admitted 30-09-2026, discharged 04-10-2026", "Lowest platelet count: 38,000/cumm"]),
      d("FINAL_BILL", "bill_CLH-77812.pdf", "2026-10-04", H.coastal, 68420, 0.94,
        { bill_no: "CLH-77812", itemised: true },
        ["Bill No: CLH-77812", "Room rent: 16,000", "Doctor visits: 9,500", "Lab: 14,920", "Pharmacy: 28,000", "Net payable: Rs 68,420"]),
      d("PHARMACY_BILL", "pharmacy_bills_combined.jpg", "2026-10-03", H.coastal, 24310, 0.58,
        { bills_count: 6, total_on_bills: 24310, legible: "partly" },
        ["Pharmacy bills (6 slips)", "Two slips are faded and partly unreadable", "Total visible: Rs 24,310"]),
      d("INVESTIGATION_REPORT", "dengue_ns1_cbc.pdf", "2026-09-30", H.coastal, null, 0.95,
        { test: "Dengue NS1 Ag, CBC", finding: "NS1 positive, platelets 62,000" },
        ["Dengue NS1 antigen: POSITIVE", "CBC: Platelets 62,000/cumm"]),
      d("KYC", "pan_card.jpg", "2023-06-01", null, null, 0.92,
        { id_kind: "PAN", id_last4: "771K", name_matches: true },
        ["PAN (masked): XXXXX771K", "Name: Priya Nair"]),
      d("POLICY_COPY", "hdfc_ergo_policy.pdf", "2026-01-15", null, null, 0.97,
        { policy_number: "HE-4410-2290-7781", sum_insured: 300000, valid_till: "2027-01-14" },
        ["Policy No: HE-4410-2290-7781", "Sum insured: Rs 3,00,000"]),
    ],
  },
  {
    id: uid("2", 3), code: "PL-100103", full_name: "Mohammed Irfan Shaikh", phone: "+919811000103",
    email: "irfan.shaikh@example.com", policy_number: "IL-HLT-0098812345", insurer: "ICICI Lombard",
    agent: uid("1", 2),
    docs: [
      d("DISCHARGE_SUMMARY", "irfan_discharge.pdf", "2026-10-20", H.western, null, 0.96,
        { diagnosis: "Closed fracture right distal radius", procedure: "ORIF with plating", admission_date: "2026-10-18", discharge_date: "2026-10-20", treating_doctor: "Dr. Sameer Joshi" },
        ["Diagnosis: Closed fracture, right distal radius (fall at home)", "Procedure: ORIF with volar locking plate on 18-10-2026", "Discharged 20-10-2026"]),
      d("FINAL_BILL", "final_bill_WGH5512.pdf", "2026-10-20", H.western, 112300, 0.95,
        { bill_no: "WGH5512", itemised: false },
        ["Bill No: WGH5512 (summary bill)", "Total: Rs 1,12,300", "Implant: volar locking plate"]),
      d("INVESTIGATION_REPORT", "xray_wrist.jpg", "2026-10-18", H.western, null, 0.9,
        { test: "X-ray right wrist AP/Lat", finding: "Displaced distal radius fracture" },
        ["X-ray right wrist: displaced fracture of distal radius"]),
      d("POLICY_COPY", "icici_policy.pdf", "2026-04-01", null, null, 0.97,
        { policy_number: "IL-HLT-0098812345", sum_insured: 1000000, valid_till: "2027-03-31" },
        ["Policy No: IL-HLT-0098812345", "Sum insured: Rs 10,00,000"]),
    ],
  },
  {
    id: uid("2", 4), code: "PL-100104", full_name: "Sunita Devi Yadav", phone: "+919811000104",
    email: "sunita.yadav@example.com", policy_number: "NB-31-77219004", insurer: "Niva Bupa",
    agent: uid("1", 2),
    docs: [
      d("DISCHARGE_SUMMARY", "sunita_ds.pdf", "2026-08-27", H.ganga, null, 0.95,
        { diagnosis: "Senile cataract left eye", procedure: "Phacoemulsification with IOL", admission_date: "2026-08-27", discharge_date: "2026-08-27" },
        ["Diagnosis: Senile mature cataract, left eye", "Procedure: Phaco with foldable IOL, day care"]),
      d("FINAL_BILL", "bill_GCH-2208.pdf", "2026-08-27", H.ganga, 42000, 0.94, { bill_no: "GCH-2208", itemised: true },
        ["Bill No: GCH-2208", "Package: Phaco + IOL", "Net payable: Rs 42,000"]),
      d("CONSULTATION_PAPER", "opd_eye_consult.jpg", "2026-08-10", H.ganga, null, 0.88,
        { doctor: "Dr. R. K. Saxena", advice: "Cataract surgery left eye" },
        ["OPD consultation 10-08-2026", "Advice: Cataract surgery LE"]),
    ],
  },
  {
    id: uid("2", 5), code: "PL-100105", full_name: "Arjun Malhotra", phone: "+919811000105",
    email: "arjun.malhotra@example.com", policy_number: "CH-5520-1187-3360", insurer: "Care Health",
    agent: uid("1", 2),
    docs: [
      d("DISCHARGE_SUMMARY", "arjun_malhotra_ds.pdf", "2026-07-12", H.lotus, null, 0.97,
        { diagnosis: "Acute inferior wall MI", procedure: "PTCA with DES to RCA", admission_date: "2026-07-08", discharge_date: "2026-07-12" },
        ["Diagnosis: Acute inferior wall myocardial infarction", "Procedure: Primary PTCA + 1 DES to RCA"]),
      d("FINAL_BILL", "lotus_bill_88123.pdf", "2026-07-12", H.lotus, 386900, 0.96, { bill_no: "LH-88123", itemised: true },
        ["Bill No: LH-88123", "Cath lab & stent: 2,10,000", "ICU: 72,000", "Net payable: Rs 3,86,900"]),
      d("INVESTIGATION_REPORT", "ecg_trop_echo.pdf", "2026-07-08", H.lotus, null, 0.94,
        { test: "ECG, Troponin I, 2D Echo", finding: "ST elevation II, III, aVF; Trop I raised; EF 45%" },
        ["ECG: ST elevation in II, III, aVF", "Troponin I: 12.4 ng/mL", "2D Echo: EF 45%"]),
      d("PHARMACY_BILL", "discharge_meds_bill.pdf", "2026-07-12", H.lotus, 8640, 0.91, { bills_count: 1 },
        ["Discharge medicines", "Total: Rs 8,640"]),
      d("CONSULTATION_PAPER", "cardiology_followup.pdf", "2026-07-26", H.lotus, null, 0.89,
        { doctor: "Dr. Vivek Arora", advice: "Continue DAPT" }, ["Follow-up 26-07-2026", "Continue DAPT, review in 3 months"]),
      d("KYC", "aadhaar_arjun.pdf", "2022-01-11", null, null, 0.95, { id_kind: "Aadhaar", id_last4: "0937", name_matches: true },
        ["Aadhaar (masked): XXXX XXXX 0937"]),
      d("CANCELLED_CHEQUE", "cancelled_cheque_hdfc.jpg", "2026-07-15", null, null, 0.93,
        { bank: "HDFC Bank", ifsc_present: true, account_last4: "4410", name_matches: true },
        ["Cancelled cheque, HDFC Bank", "A/c ending 4410"]),
    ],
  },
  {
    id: uid("2", 6), code: "PL-100106", full_name: "Lakshmi Venkataraman", phone: "+919811000106",
    email: "lakshmi.v@example.com", policy_number: "BA-HP-22-4478812", insurer: "Bajaj Allianz",
    agent: uid("1", 3),
    docs: [
      d("DISCHARGE_SUMMARY", "lakshmi_ds.pdf", "2026-09-02", H.sahyadri, null, 0.96,
        { diagnosis: "Fibroid uterus with menorrhagia", procedure: "Total laparoscopic hysterectomy", admission_date: "2026-08-30", discharge_date: "2026-09-02" },
        ["Diagnosis: Multiple uterine fibroids with menorrhagia", "Procedure: TLH on 31-08-2026"]),
      d("FINAL_BILL", "sahyadri_bill_SC9930.pdf", "2026-09-02", H.sahyadri, 165400, 0.95, { bill_no: "SC9930", itemised: true },
        ["Bill No: SC9930", "Net payable: Rs 1,65,400"]),
      d("INVESTIGATION_REPORT", "usg_pelvis_histopath.pdf", "2026-08-20", H.sahyadri, null, 0.92,
        { test: "USG pelvis", finding: "Multiple intramural fibroids, largest 6.2 cm" }, ["USG pelvis: multiple intramural fibroids"]),
      d("POLICY_COPY", "bajaj_policy.pdf", "2026-02-10", null, null, 0.97,
        { policy_number: "BA-HP-22-4478812", sum_insured: 500000 }, ["Policy No: BA-HP-22-4478812"]),
      d("CANCELLED_CHEQUE", "cheque_sbi.jpg", "2026-09-05", null, null, 0.87,
        { bank: "State Bank of India", ifsc_present: true, account_last4: "1192", name_matches: true }, ["Cancelled cheque, SBI"]),
    ],
  },
  {
    id: uid("2", 7), code: "PL-100107", full_name: "Gurpreet Singh Bedi", phone: "+919811000107",
    email: "gurpreet.bedi@example.com", policy_number: "ABH-GP-0045521", insurer: "Aditya Birla Health",
    agent: uid("1", 3),
    docs: [
      d("DISCHARGE_SUMMARY", "gurpreet_discharge.pdf", "2026-10-11", H.sunrise, null, 0.95,
        { diagnosis: "Community acquired pneumonia", admission_date: "2026-10-06", discharge_date: "2026-10-11" },
        ["Diagnosis: Right lower lobe community acquired pneumonia", "IV antibiotics x 5 days"]),
      d("FINAL_BILL", "bill_IP2610066.pdf", "2026-10-11", H.sunrise, 92800, 0.94, { bill_no: "IP2610066", itemised: true },
        ["Bill No: IP2610066", "Net payable: Rs 92,800"]),
      d("INVESTIGATION_REPORT", "chest_xray_cbc.pdf", "2026-10-06", H.sunrise, null, 0.93,
        { test: "Chest X-ray, CBC, CRP", finding: "RLL consolidation; TLC 15,800" }, ["CXR: RLL consolidation", "TLC 15,800, CRP 96"]),
    ],
  },
  {
    id: uid("2", 8), code: "PL-100108", full_name: "Ananya Ghosh", phone: "+919811000108",
    email: "ananya.ghosh@example.com", policy_number: "TA-MED-7781230", insurer: "TATA AIG",
    agent: uid("1", 3),
    docs: [
      d("DISCHARGE_SUMMARY", "ananya_ds.pdf", "2026-09-25", H.deccan, null, 0.96,
        { diagnosis: "Acute appendicitis", procedure: "Laparoscopic appendicectomy", admission_date: "2026-09-23", discharge_date: "2026-09-25" },
        ["Diagnosis: Acute appendicitis", "Procedure: Laparoscopic appendicectomy"]),
      d("FINAL_BILL", "dmi_bill_44120.pdf", "2026-09-25", H.deccan, 98600, 0.95, { bill_no: "DMI-44120", itemised: true },
        ["Bill No: DMI-44120", "Net payable: Rs 98,600"]),
      d("INVESTIGATION_REPORT", "ct_abdomen.pdf", "2026-09-23", H.deccan, null, 0.94,
        { test: "CECT abdomen", finding: "Inflamed appendix 11 mm" }, ["CECT abdomen: inflamed appendix, 11 mm"]),
      d("PHARMACY_BILL", "pharmacy_dmi.pdf", "2026-09-25", H.deccan, 6120, 0.9, { bills_count: 2 }, ["Pharmacy: Rs 6,120"]),
      d("KYC", "aadhaar_ananya.jpg", "2021-05-19", null, null, 0.94, { id_kind: "Aadhaar", id_last4: "6612", name_matches: true },
        ["Aadhaar (masked): XXXX XXXX 6612"]),
      d("POLICY_COPY", "tata_aig_policy.pdf", "2026-03-01", null, null, 0.97, { policy_number: "TA-MED-7781230", sum_insured: 700000 },
        ["Policy No: TA-MED-7781230"]),
    ],
  },
  {
    id: uid("2", 9), code: "PL-100109", full_name: "Kavita Joshi", phone: "+919811000109",
    email: "kavita.joshi@example.com", policy_number: "SH-2026-11094422", insurer: "Star Health",
    agent: uid("1", 3),
    docs: [
      d("DISCHARGE_SUMMARY", "kavita_joshi_ds.pdf", "2026-10-15", H.western, null, 0.95,
        { diagnosis: "Acute gastroenteritis with dehydration", admission_date: "2026-10-13", discharge_date: "2026-10-15" },
        ["Diagnosis: Acute gastroenteritis with moderate dehydration"]),
      d("FINAL_BILL", "wgh_bill_5609.pdf", "2026-10-15", H.western, 38450, 0.94, { bill_no: "WGH5609", itemised: true },
        ["Bill No: WGH5609", "Net payable: Rs 38,450"]),
      d("CONSULTATION_PAPER", "emergency_notes.jpg", "2026-10-13", H.western, null, 0.86,
        { doctor: "Dr. P. Kulkarni", advice: "Admit for IV fluids" }, ["ER notes: 8 episodes of vomiting, admit for IV fluids"]),
      d("KYC", "voter_id.jpg", "2020-02-02", null, null, 0.9, { id_kind: "Voter ID", id_last4: "3390", name_matches: true },
        ["Voter ID (masked): XXX3390"]),
    ],
  },
  {
    id: uid("2", 10), code: "PL-100110", full_name: "Deepak Choudhary", phone: "+919811000110",
    email: "deepak.choudhary@example.com", policy_number: "NB-31-90011276", insurer: "Niva Bupa",
    agent: null, // unassigned: only admins can see this patient
    docs: [
      d("DISCHARGE_SUMMARY", "deepak_ds.pdf", "2026-10-26", H.lotus, null, 0.94,
        { diagnosis: "Renal calculus with hydronephrosis", procedure: "URSL with DJ stenting", admission_date: "2026-10-25", discharge_date: "2026-10-26" },
        ["Diagnosis: Left ureteric calculus 9 mm with hydronephrosis", "Procedure: URSL + DJ stent"]),
      d("FINAL_BILL", "lotus_bill_90122.pdf", "2026-10-26", H.lotus, 121500, 0.95, { bill_no: "LH-90122", itemised: true },
        ["Bill No: LH-90122", "Net payable: Rs 1,21,500"]),
      d("INVESTIGATION_REPORT", "ct_kub.pdf", "2026-10-24", H.lotus, null, 0.93,
        { test: "NCCT KUB", finding: "9 mm left lower ureteric calculus" }, ["NCCT KUB: 9 mm left lower ureteric calculus"]),
    ],
  },
];

// ---------------------------------------------------------------------------
// Query letters
// ---------------------------------------------------------------------------
export interface PointSeed {
  point_no: number;
  point_text: string;
  insurer_ask: string;
  needed_doc_type: DocType | null;
  decision: "HAVE" | "NEED_FROM_PATIENT" | "HAVE_BUT_UNCLEAR";
  matched_document_id: string | null;
  reason: string;
  confidence: number;
  needs_review?: boolean;
}

export interface LetterSeed {
  id: string;
  patient_id: string;
  file_name: string;
  status: "RECEIVED" | "SENT" | "NEEDS_REVIEW";
  received_at: string;
  lines: string[]; // letter text (also rendered to PDF)
  points: PointSeed[];
  messages?: { channel: "WHATSAPP" | "EMAIL"; status: "SENT" | "DELIVERED"; body: string; subject?: string }[];
}

const doc = (p: number, type: DocType) => {
  const found = PATIENTS[p - 1].docs.find((x) => x.type === type);
  if (!found) throw new Error(`fixture: patient ${p} has no ${type}`);
  return found.id;
};

export const LETTERS: LetterSeed[] = [
  {
    id: uid("4", 1),
    patient_id: uid("2", 1),
    file_name: "StarHealth_Query_CLM2609-55102.pdf",
    status: "SENT",
    received_at: "2026-10-28T10:12:00+05:30",
    lines: [
      "STAR HEALTH AND ALLIED INSURANCE CO. LTD. (fictional demo letter)",
      "Claim No: CLM2609-55102    Policy No: SH-2025-88310457",
      "Patient: Rajesh Kumar Verma    Hospital: Sunrise Multispeciality Hospital, Gurugram",
      "Date: 28-10-2026",
      "Subject: Query on claim - documents required",
      "With reference to the above claim, kindly provide the following to process it further:",
      "1. Indoor case papers (ICP) with daily progress notes for the entire hospitalisation.",
      "2. Detailed itemised final bill with break-up of OT and consumable charges.",
      "3. Pre-operative ultrasound report supporting the diagnosis.",
      "4. First consultation paper showing date of first symptoms and duration of complaints.",
      "Please submit the above within 15 days, failing which the claim may be closed.",
    ],
    points: [
      { point_no: 1, point_text: "Indoor case papers (ICP) with daily progress notes for the entire hospitalisation.", insurer_ask: "Hospital's daily treatment notes for each day of the stay", needed_doc_type: "OTHER", decision: "NEED_FROM_PATIENT", matched_document_id: null, reason: "No indoor case papers in the locker; only the discharge summary is present.", confidence: 0.92 },
      { point_no: 2, point_text: "Detailed itemised final bill with break-up of OT and consumable charges.", insurer_ask: "Itemised final hospital bill", needed_doc_type: "FINAL_BILL", decision: "HAVE", matched_document_id: doc(1, "FINAL_BILL"), reason: "Final bill IP2609151 is itemised with OT and consumables shown separately.", confidence: 0.9 },
      { point_no: 3, point_text: "Pre-operative ultrasound report supporting the diagnosis.", insurer_ask: "Ultrasound report taken before surgery", needed_doc_type: "INVESTIGATION_REPORT", decision: "HAVE", matched_document_id: doc(1, "INVESTIGATION_REPORT"), reason: "USG abdomen dated 15-09-2026 (before surgery) shows gall bladder stones.", confidence: 0.95 },
      { point_no: 4, point_text: "First consultation paper showing date of first symptoms and duration of complaints.", insurer_ask: "Doctor's paper from the first visit when symptoms started", needed_doc_type: "CONSULTATION_PAPER", decision: "NEED_FROM_PATIENT", matched_document_id: null, reason: "No consultation paper in the locker.", confidence: 0.94 },
    ],
    messages: [
      { channel: "WHATSAPP", status: "DELIVERED", body: "Hello Rajesh Kumar Verma,\n\nStar Health has asked for 2 more documents for your claim (Patient ID PL-100101).\n\nPlease send:\n1. Hospital daily treatment notes (indoor case papers) - the insurer wants to see the treatment given on each day.\n2. Paper from your first doctor visit - the insurer wants to know when your symptoms started.\n\nWe already have your final bill and ultrasound report, so you don't need to send those again.\n\nReply here or email us. Thank you." },
      { channel: "EMAIL", status: "SENT", subject: "Documents needed for your claim (PL-100101)", body: "Hello Rajesh Kumar Verma,\n\nStar Health has asked for 2 more documents for your claim (Patient ID PL-100101).\n\nPlease send:\n1. Hospital daily treatment notes (indoor case papers) - the insurer wants to see the treatment given on each day.\n2. Paper from your first doctor visit - the insurer wants to know when your symptoms started.\n\nWe already have your final bill and ultrasound report, so you don't need to send those again.\n\nReply to this email or on WhatsApp. Thank you." },
    ],
  },
  {
    id: uid("4", 2),
    patient_id: uid("2", 2),
    file_name: "HDFCERGO_Query_RR-HE-118842.pdf",
    status: "NEEDS_REVIEW",
    received_at: "2026-10-30T15:40:00+05:30",
    lines: [
      "HDFC ERGO GENERAL INSURANCE (fictional demo letter)",
      "Claim Ref: RR-HE-118842    Policy: HE-4410-2290-7781",
      "Insured patient: Priya Nair    Hospital: Coastal Life Hospital, Kochi",
      "Date: 30-10-2026",
      "Deficiency letter",
      "a) Pharmacy bills submitted are illegible. Please submit clear copies of all pharmacy bills with prescriptions.",
      "b) Cancelled cheque bearing the name of the proposer for NEFT.",
      "c) Copy of KYC of the proposer.",
      "d) Platelet count reports for all days of hospitalisation.",
    ],
    points: [
      { point_no: 1, point_text: "Pharmacy bills submitted are illegible. Please submit clear copies of all pharmacy bills with prescriptions.", insurer_ask: "Clear copies of all pharmacy bills with prescriptions", needed_doc_type: "PHARMACY_BILL", decision: "NEED_FROM_PATIENT", matched_document_id: doc(2, "PHARMACY_BILL"), reason: "Insurer says current pharmacy bills are illegible; a fresh clear copy is needed.", confidence: 0.91 },
      { point_no: 2, point_text: "Cancelled cheque bearing the name of the proposer for NEFT.", insurer_ask: "Cancelled cheque with the policyholder's name", needed_doc_type: "CANCELLED_CHEQUE", decision: "NEED_FROM_PATIENT", matched_document_id: null, reason: "No cancelled cheque in the locker.", confidence: 0.96 },
      { point_no: 3, point_text: "Copy of KYC of the proposer.", insurer_ask: "ID proof (KYC) of the policyholder", needed_doc_type: "KYC", decision: "HAVE", matched_document_id: doc(2, "KYC"), reason: "PAN card in locker; name matches the patient, who is also the proposer.", confidence: 0.82 },
      { point_no: 4, point_text: "Platelet count reports for all days of hospitalisation.", insurer_ask: "Daily platelet count reports for the whole stay", needed_doc_type: "INVESTIGATION_REPORT", decision: "HAVE_BUT_UNCLEAR", matched_document_id: doc(2, "INVESTIGATION_REPORT"), reason: "Locker has only the admission-day CBC; unclear whether daily reports exist.", confidence: 0.48, needs_review: true },
    ],
    messages: [
      { channel: "WHATSAPP", status: "DELIVERED", body: "Hello Priya Nair,\n\nHDFC ERGO has asked for 2 more documents for your claim (Patient ID PL-100102).\n\nPlease send:\n1. Clear copies of all pharmacy bills with the doctor's prescriptions - the copies we have are hard to read.\n2. A cancelled cheque with your name printed on it - the insurer needs it to pay you by bank transfer.\n\nWe already have your ID proof (PAN).\n\nOur team is checking one more point and will contact you if anything else is needed. Thank you." },
      { channel: "EMAIL", status: "SENT", subject: "Documents needed for your claim (PL-100102)", body: "Hello Priya Nair,\n\nHDFC ERGO has asked for 2 more documents for your claim (Patient ID PL-100102).\n\nPlease send:\n1. Clear copies of all pharmacy bills with the doctor's prescriptions - the copies we have are hard to read.\n2. A cancelled cheque with your name printed on it - the insurer needs it to pay you by bank transfer.\n\nWe already have your ID proof (PAN).\n\nOur team is checking one more point and will contact you if anything else is needed. Thank you." },
    ],
  },
  {
    id: uid("4", 3),
    patient_id: uid("2", 3),
    file_name: "ICICILombard_Query_IL-CL-7720931.pdf",
    status: "RECEIVED", // left unprocessed so you can run the pipeline on it in phase 4
    received_at: "2026-11-01T11:05:00+05:30",
    lines: [
      "ICICI LOMBARD GENERAL INSURANCE (fictional demo letter)",
      "Claim No: IL-CL-7720931    Policy No: IL-HLT-0098812345",
      "Patient: Mohammed Irfan Shaikh    Hospital: Western Ghats Hospital, Pune",
      "Date: 01-11-2026",
      "Dear Sir/Madam,",
      "We have reviewed the above claim. To proceed, please arrange the following:",
      "1. Itemised final bill. The bill submitted is a summary bill without break-up.",
      "2. Implant sticker / invoice for the volar locking plate used.",
      "3. MLC / FIR copy, or a declaration from the treating doctor that the injury is not medico-legal.",
      "4. Post-operative X-ray report.",
      "5. Copy of policy document.",
      "Kindly submit within 7 days.",
    ],
    points: [],
  },
];
