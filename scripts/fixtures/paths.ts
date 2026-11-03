export const BUCKET = "patient-files";

const safe = (name: string) => name.replace(/[^A-Za-z0-9._-]/g, "_");

/** '<patient_id>/documents/<doc_id>-<file>' — first folder MUST be the patient id (storage RLS relies on it). */
export const documentPath = (patientId: string, docId: string, fileName: string) =>
  `${patientId}/documents/${docId}-${safe(fileName)}`;

export const queryLetterPath = (patientId: string, letterId: string, fileName: string) =>
  `${patientId}/queries/${letterId}-${safe(fileName)}`;
