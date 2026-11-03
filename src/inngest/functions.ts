import { classifyUploadedDocument } from "@/inngest/classify-document";
import { processQueryLetter } from "@/inngest/process-query-letter";
import { sendLetterMessages } from "@/inngest/send-messages";

export const functions = [processQueryLetter, classifyUploadedDocument, sendLetterMessages];
