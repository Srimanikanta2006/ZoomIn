export type UUID = string;
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type Role = "applicant" | "scrutiny_officer" | "regional_officer" | "admin";
export type ApplicationStatus = "draft" | "submitted" | "under_review" | "returned_for_clarification" | "completed";
export type DocumentType = "application_form" | "land_record" | "building_plan" | "faculty_record" | "other";
export type VerificationStatus = "not_started" | "in_progress" | "verified" | "discrepancy" | "inconclusive" | "unable_to_verify";
export interface VerificationCheckRecord {
  id: UUID;
  application_id: UUID;
  document_id: UUID;
  source: string;
  checked_at: string;
  status: VerificationStatus;
  result: Record<string, JsonValue>;
  requires_manual_review: boolean;
}
export type FindingSeverity = "info" | "low" | "medium" | "high" | "critical";
export type FindingStatus = "open" | "under_review" | "resolved" | "dismissed";
export type ReviewAction = "accept" | "dismiss" | "request";

export interface Institution {
  id: UUID;
  institution_code: string;
  name: string;
  institution_type: string;
  state: string;
  district: string;
  created_at: string;
}

export interface Application {
  id: UUID;
  institution_id: UUID;
  application_number: string;
  application_type: string;
  academic_year: string;
  status: ApplicationStatus;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentRecord {
  id: UUID;
  application_id: UUID;
  document_type: DocumentType;
  file_name: string;
  storage_path: string;
  sha256: string;
  mime_type: string;
  page_count: number | null;
  uploaded_at: string;
  metadata: Record<string, JsonValue>;
}

export interface ExtractedField {
  id: UUID;
  application_id: UUID;
  document_id: UUID;
  field_key: string;
  field_value: JsonValue;
  page: number | null;
  bbox: JsonValue | null;
  confidence: number | null;
  extractor: string;
  created_at: string;
}

export interface Claim {
  id: UUID;
  application_id: UUID;
  document_id: UUID | null;
  field_key: string;
  claim_value: JsonValue;
  source: string;
  created_at: string;
}

export type ClaimLedgerStatus = "Supported" | "Contradicted" | "Unsupported" | "Expired";

export interface EvidenceBox {
  page: number | null;
  bbox: [number, number, number, number] | null;
  word?: string | null;
}

export interface PdfFontSpan {
  font: string;
  text: string;
  page: number;
  bbox: [number, number, number, number];
}

export interface ValidationDocumentInput {
  document_id: string;
  file_name: string;
  document_type: string;
  sha256: string;
  fields: Record<string, JsonValue>;
  field_boxes: Record<string, EvidenceBox[]>;
  pdf_metadata?: Record<string, JsonValue>;
  revision_count?: number | null;
  signature_present?: boolean | null;
  signature_intact?: boolean | null;
  signature_covers_file?: boolean | null;
  field_font_spans?: Record<string, PdfFontSpan[]>;
}

export interface ClaimEvidenceLink {
  document_id: string;
  document_name: string;
  field_key: string;
  value: JsonValue;
  page: number | null;
  bbox: [number, number, number, number] | null;
}

export interface ClaimLedgerEntry {
  claim_id: UUID;
  application_id: UUID;
  field_key: string;
  declared_value: JsonValue;
  status: ClaimLedgerStatus;
  evidence_fields: ClaimEvidenceLink[];
  finding: Finding;
}

export interface ValidationResponse {
  findings: Finding[];
  claims: ClaimLedgerEntry[];
}

export interface FindingDocument {
  document_id: UUID;
  name: string;
}

export interface FindingEvidence {
  page: number | null;
  bbox: [number, number, number, number] | null;
  extracted: string;
}

/** Canonical finding payload shared by every validation module. */
export interface Finding {
  finding_id: UUID;
  application_id: UUID;
  type: string;
  severity: FindingSeverity;
  document: FindingDocument;
  evidence: FindingEvidence;
  rule_id: string;
  reason: string;
  confidence: number;
  status: FindingStatus;
}

export interface Verification {
  id: UUID;
  application_id: UUID;
  document_id: UUID | null;
  finding_id: UUID | null;
  verification_type: string;
  source: string;
  checked_at: string;
  status: VerificationStatus;
  result: Record<string, JsonValue>;
  requires_manual_review: boolean;
  verifier_id: UUID | null;
  remarks: string;
  verified_at: string | null;
  created_at: string;
}

export interface Review {
  id: UUID;
  application_id: UUID;
  finding_id: UUID | null;
  reviewer_id: UUID;
  action: ReviewAction;
  remarks: string;
  created_at: string;
}

export interface GraphEdge {
  id: UUID;
  application_id: UUID;
  source_type: string;
  source_id: UUID;
  target_type: string;
  target_id: UUID;
  edge_type: string;
  weight: number | null;
  metadata: Record<string, JsonValue>;
  created_at: string;
}

export interface AuditLogEntry {
  id: number;
  actor_id: UUID | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  occurred_at: string;
  details: Record<string, JsonValue>;
  prev_hash: string | null;
  hash: string;
}

export interface AuditIntegrityResult {
  valid: boolean;
  checked_count: number;
  first_invalid_id: number | null;
  checked_at: string;
}

export interface DeficiencyLetter {
  id: UUID;
  application_id: UUID;
  language: "en" | "hi";
  content: string;
  finding_ids: UUID[];
  status: "draft" | "approved";
  created_by: UUID;
  created_at: string;
  updated_at: string;
  approved_by: UUID | null;
  approved_at: string | null;
  approval_remarks: string;
}

export interface HandbookRuleProposal {
  id: UUID;
  source_sha256: string;
  source_redacted: string;
  redaction_summary: Record<string, number>;
  proposed_rule_yaml: string;
  status: "proposed" | "approved" | "rejected";
  created_by: UUID;
  created_at: string;
  approved_by: UUID | null;
  approved_at: string | null;
}

export type LifecycleStatus =
  | "draft"
  | "submitted"
  | "auto_checked"
  | "in_review"
  | "notice_issued"
  | "awaiting_institution"
  | "re_checked"
  | "closed";

export type CaseOutcome = "clear" | "return_for_clarification" | "refer_for_inspection";

export type NoticeStatus = "draft" | "approved" | "responded";

export interface NoticeRecord {
  id: UUID;
  application_id: UUID;
  language: "en" | "hi";
  content: string;
  finding_ids: UUID[];
  status: NoticeStatus;
  created_at: string;
  approved_at: string | null;
  approval_remarks: string;
  applicant_response?: string | null;
  responded_at?: string | null;
  recheck_diff?: {
    resolved: string[];
    still_open: string[];
    new_issues: string[];
  };
}

export interface TrustAlertItem {
  id: string;
  alert_type: "shared faculty" | "duplicate document" | "shared address";
  entities: string[];
  applications: string[];
  status: "New" | "Reviewed" | "Escalated";
  masked_entity: string;
  explanation: string;
  review_note?: string;
  node_ids?: string[];
}

export interface PreCheckResult {
  document_type: string;
  status: "looks_good" | "needs_fixing" | "checking";
  reason: string;
  blocker: boolean;
  rule_id?: string;
  file_name?: string;
}

export interface RuleData {
  version: number;
  reference_date: string;
  rules: Array<Record<string, unknown>>;
  checklists: Record<string, { required_documents?: string[] }>;
  officer_lanes: Record<string, { severities?: string[]; statuses?: string[] }>;
  officer_timelines?: { review_deadline_days?: number; approaching_deadline_days?: number; ageing_warning_days?: number };
  display_options: Record<string, { near_expiry_days?: number }>;
}
