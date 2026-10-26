"use client";

import React, { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import {
  FileText,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  ChevronRight,
  ShieldAlert,
  ShieldCheck,
  Send,
  UserCheck,
  Download,
  Printer,
  Eye,
  FileCheck,
  Layers,
  History,
  QrCode,
  FileSignature,
  Hash,
  HelpCircle,
  Building,
  Calendar,
} from "lucide-react";
import type {
  ApplicationRow,
  DocumentRow,
  FieldRow,
  ClaimRow,
  VerificationRow,
  AuditRow,
} from "./review-workspace";
import type { Role, LifecycleStatus, CaseOutcome, Finding } from "@/lib/models";
import { getSupabaseClient } from "@/lib/supabase";

interface CaseFileWorkspaceProps {
  app: ApplicationRow;
  docs: DocumentRow[];
  findings: Finding[];
  fields: FieldRow[];
  claims: ClaimRow[];
  verifications: VerificationRow[];
  role: Role | null;
  onRefresh?: () => Promise<void> | void;
}

const LIFECYCLE_STEPS: Array<{ id: LifecycleStatus; label: string }> = [
  { id: "submitted", label: "Submitted" },
  { id: "auto_checked", label: "Auto-checked" },
  { id: "in_review", label: "In review" },
  { id: "notice_issued", label: "Notice issued" },
  { id: "awaiting_institution", label: "Awaiting institution" },
  { id: "re_checked", label: "Re-checked" },
  { id: "closed", label: "Closed" },
];

export function CaseFileWorkspace({
  app,
  docs,
  findings,
  fields,
  claims,
  verifications,
  role,
  onRefresh,
}: CaseFileWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<"claims" | "verification" | "validity" | "history" | "notice">("claims");
  const [selectedDocId, setSelectedDocId] = useState<string>(docs[0]?.id || "");
  const [selectedBox, setSelectedBox] = useState<[number, number, number, number] | null>(null);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewError, setPreviewError] = useState("");

  // Finding action modal state
  const [actionModal, setActionModal] = useState<{
    finding: Finding;
    action: "accept" | "dismiss" | "request";
  } | null>(null);
  const [remarks, setRemarks] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState("");

  // Case outcome state
  const [currentStatus, setCurrentStatus] = useState<string>(() => (
    app.status === "completed" ? "closed" :
    app.status === "returned_for_clarification" ? "notice_issued" :
    app.status === "under_review" ? "in_review" : "submitted"
  ));
  const [assignedOfficer, setAssignedOfficer] = useState<string | null>(() => {
    const current = (app as unknown as { assigned_officer?: string }).assigned_officer;
    return current ? (current.includes("@") ? current : "Assigned") : null;
  });
  const [outcome, setOutcome] = useState<CaseOutcome | "">("");
  const [outcomeRemarks, setOutcomeRemarks] = useState("");
  const [outcomeMessage, setOutcomeMessage] = useState("");

  // Notice draft state
  const [noticeLanguage, setNoticeLanguage] = useState<"en" | "hi">("en");
  const [noticeContent, setNoticeContent] = useState<string>("");
  const [noticeApproved, setNoticeApproved] = useState(false);
  const [noticeId, setNoticeId] = useState<string | null>(null);
  const [noticeBusy, setNoticeBusy] = useState(false);
  const [noticeApprovalRemarks, setNoticeApprovalRemarks] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const [exportError, setExportError] = useState("");

  // History / Audit log state
  const [caseAuditRows, setCaseAuditRows] = useState<AuditRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");

  // Selected document object
  const selectedDoc = useMemo(() => {
    return docs.find((d) => d.id === selectedDocId) || docs[0] || null;
  }, [docs, selectedDocId]);

  useEffect(() => {
    let active = true;
    async function loadPreview() {
      setPreviewUrl("");
      setPreviewError("");
      if (!selectedDoc) return;
      const client = getSupabaseClient();
      if (!client) {
        setPreviewError("Supabase is not configured.");
        return;
      }
      const { data, error } = await client.storage
        .from("application-documents")
        .createSignedUrl(selectedDoc.storage_path, 300);
      if (!active) return;
      if (error) {
        setPreviewError(error.message);
        return;
      }
      setPreviewUrl(data.signedUrl);
    }
    void loadPreview();
    return () => {
      active = false;
    };
  }, [selectedDoc]);

  // Load audit history for this case
  useEffect(() => {
    async function loadHistory() {
      setHistoryLoading(true);
      setHistoryError("");
      const client = getSupabaseClient();
      if (!client) {
        setCaseAuditRows([]);
        setHistoryError("Supabase is not configured.");
        setHistoryLoading(false);
        return;
      }
      const { data, error } = await client.rpc("get_case_history", { p_application_id: app.id });
      if (error) setHistoryError(error.message);
      setCaseAuditRows((data ?? []) as unknown as AuditRow[]);
      setHistoryLoading(false);
    }
    void loadHistory();
  }, [app.id]);

  // Assemble accepted findings for the Notice Tab
  const acceptedFindings = useMemo(() => {
    return findings.filter((f) => f.status === "resolved");
  }, [findings]);

  // Assemble accepted findings into official statutory notice draft
  const handleDraftNotice = (lang: "en" | "hi" = noticeLanguage) => {
    const instName = (app as unknown as { institutions?: { name?: string } })?.institutions?.name || "Institution";
    const items = acceptedFindings.length
      ? acceptedFindings.map((finding, index) => (
        lang === "hi"
          ? `${index + 1}. दस्तावेज़: ${String((finding.document as { name?: string })?.name || "दस्तावेज़")}\n   नियम: ${finding.rule_id}\n   संकेतक: ${finding.reason}`
          : `${index + 1}. Document: ${String((finding.document as { name?: string })?.name || "Document")}\n   Rule: ${finding.rule_id}\n   Indicator: ${finding.reason}`
      )).join("\n\n")
      : lang === "hi"
        ? "कोई स्वीकृत निष्कर्ष नहीं है।"
        : "No accepted findings yet. Accept findings in the Claims and Indicators tab to assemble a notice.";
    const content = lang === "hi"
      ? `प्रति: ${instName}\nआवेदन संख्या: ${app.application_number}\nशैक्षणिक सत्र: ${app.academic_year}\n\nविषय: कमी के संबंध में सूचना\n\n${items}\n\nकृपया आवेदन पोर्टल के माध्यम से अपना उत्तर और संशोधित दस्तावेज़ प्रस्तुत करें। अंतिम निर्णय मानव अधिकारी करेंगे।`
      : `To: ${instName}\nApplication No: ${app.application_number}\nAcademic Year: ${app.academic_year}\n\nSubject: Scrutiny notice\n\n${items}\n\nPlease submit your response and corrected documents through the applicant workspace. An officer will make the final decision.`;
    setNoticeContent(content);
    return content;
  };

  const handleCreateNoticeDraft = async () => {
    if (!acceptedFindings.length) {
      setNoticeMessage("Accept at least one finding before drafting a notice.");
      return;
    }
    const client = getSupabaseClient();
    if (!client) {
      setNoticeMessage("Supabase is not configured.");
      return;
    }
    setNoticeBusy(true);
    setNoticeMessage("");
    try {
      const content = handleDraftNotice(noticeLanguage);
      const { data, error } = await client.rpc("create_deficiency_letter", {
        p_application_id: app.id,
        p_language: noticeLanguage,
        p_content: content,
        p_finding_ids: acceptedFindings.map((finding) => finding.finding_id),
      });
      if (error) throw error;
      setNoticeId(String(data));
      setNoticeApproved(false);
      setNoticeMessage("Draft saved. Edit it before approval.");
    } catch (error) {
      setNoticeMessage(error instanceof Error ? error.message : "Notice draft could not be saved.");
    } finally {
      setNoticeBusy(false);
    }
  };

  const handleApproveNotice = async () => {
    if (!noticeId || !noticeApprovalRemarks.trim()) return;
    const client = getSupabaseClient();
    if (!client) {
      setNoticeMessage("Supabase is not configured.");
      return;
    }
    setNoticeBusy(true);
    setNoticeMessage("");
    try {
      const { error: editError } = await client.rpc("update_deficiency_letter", {
        p_letter_id: noticeId,
        p_content: noticeContent,
      });
      if (editError) throw editError;
      const { error: approvalError } = await client.rpc("approve_deficiency_letter", {
        p_letter_id: noticeId,
        p_remarks: noticeApprovalRemarks.trim(),
      });
      if (approvalError) throw approvalError;
      setNoticeApproved(true);
      setNoticeMessage("Notice approved and delivered to the applicant workspace.");
      setNoticeApprovalRemarks("");
      if (onRefresh) await onRefresh();
    } catch (error) {
      setNoticeMessage(error instanceof Error ? error.message : "Notice approval could not be saved.");
    } finally {
      setNoticeBusy(false);
    }
  };

  // Initial load of notice content
  useEffect(() => {
    handleDraftNotice(noticeLanguage);
  }, [acceptedFindings.length, noticeLanguage, app.id]);

  // Split findings into claim-related vs document-level anomalies
  const { claimList, anomalyFindings } = useMemo(() => {
    const rawClaims = claims.map((claim) => {
      const evidence = fields.filter(
        (field) =>
          field.application_id === app.id &&
          field.field_key === claim.field_key &&
          (!claim.document_id || field.document_id === claim.document_id)
      );
      const normalized = (value: unknown) => JSON.stringify(value ?? null).trim().toLocaleLowerCase();
      const matches = evidence.some((field) => normalized(field.field_value) === normalized(claim.claim_value));
      const isExpired = claim.field_key.includes("valid_until") && evidence.some((field) => {
        const dateValue = new Date(String(field.field_value));
        return Number.isFinite(dateValue.getTime()) && dateValue.getTime() < Date.now();
      });
      const status = evidence.length === 0
        ? "Unsupported"
        : isExpired
          ? "Expired"
          : matches
            ? "Supported"
            : "Contradicted";
      return { ...claim, status, evidence_fields: evidence };
    });

    // Anomalies are findings not tied directly to a specific claim
    const anomalies = findings.filter(
      (f) =>
        f.type.includes("anomaly") ||
        f.rule_id.includes("DUPLICATE") ||
        f.rule_id.includes("SIGNATURE") ||
        f.rule_id.includes("METADATA") ||
        f.reason.toLowerCase().includes("font") ||
        f.reason.toLowerCase().includes("duplicate")
    );

    return { claimList: rawClaims, anomalyFindings: anomalies };
  }, [claims, app.id, fields, findings]);

  // Handle Finding Action (Accept, Dismiss, Request)
  const handleFindingAction = async () => {
    if (!actionModal) return;
    if ((actionModal.action === "dismiss" || actionModal.action === "request") && !remarks.trim()) {
      setActionMessage("Remarks are required to record this action.");
      return;
    }

    setActionBusy(true);
    setActionMessage("");
    const supabase = getSupabaseClient();
    try {
      if (!supabase) throw new Error("Supabase is not configured.");
      const { error } = await supabase.rpc("record_finding_review", {
        p_application_id: app.id,
        p_finding_id: actionModal.finding.finding_id,
        p_action: actionModal.action,
        p_remarks: remarks || "Officer reviewed indicator.",
      });
      if (error) throw error;

      setActionMessage(`Action '${actionModal.action}' successfully recorded and logged.`);
      if (onRefresh) await onRefresh();
      setTimeout(() => {
        setActionModal(null);
        setRemarks("");
        setActionMessage("");
      }, 900);
    } catch (err: unknown) {
      setActionMessage((err as { message?: string })?.message || "Failed to record review action.");
    } finally {
      setActionBusy(false);
    }
  };

  // Handle Case Outcome submission
  const handleCaseOutcome = async () => {
    if (!outcome) {
      setOutcomeMessage("Please select a case outcome.");
      return;
    }
    if (!outcomeRemarks.trim()) {
      setOutcomeMessage("Mandatory officer remarks are required to finalize case outcome.");
      return;
    }

    const supabase = getSupabaseClient();
    try {
      if (!supabase) throw new Error("Supabase is not configured.");
      const { error } = await supabase.rpc("record_case_outcome", {
        p_application_id: app.id,
        p_outcome: outcome,
        p_remarks: outcomeRemarks.trim(),
      });
      if (error) throw error;
      const nextStatus = outcome === "clear" ? "closed" : outcome === "return_for_clarification" ? "notice_issued" : "in_review";
      setCurrentStatus(nextStatus);
      setOutcomeMessage(`Case outcome successfully set to '${outcome.replaceAll("_", " ")}'.`);
      if (onRefresh) await onRefresh();
    } catch (error) {
      setOutcomeMessage(error instanceof Error ? error.message : "Case outcome could not be saved.");
    }
  };

  // Assign to me handler
  const handleAssignToMe = async () => {
    const supabase = getSupabaseClient();
    try {
      if (!supabase) throw new Error("Supabase is not configured.");
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) throw new Error("Your officer session could not be verified.");
      const { error } = await supabase.rpc("assign_case_to_me", { p_application_id: app.id });
      if (error) throw error;
      setAssignedOfficer(userData.user.email || "Assigned to me");
      if (onRefresh) await onRefresh();
    } catch (error) {
      setOutcomeMessage(error instanceof Error ? error.message : "Case could not be assigned.");
    }
  };

  const handleExportReport = async () => {
    setExportError("");
    const client = getSupabaseClient();
    if (!client) {
      setExportError("Supabase is not configured.");
      return;
    }
    const { error } = await client.rpc("log_case_report_export", { p_application_id: app.id });
    if (error) {
      setExportError(error.message);
      return;
    }
    window.print();
  };

  // Verification checks per document
  const verificationList = useMemo(() => {
    const statuses: Record<string, string> = {
      verified: "verified",
      discrepancy: "mismatch detected",
      expired: "expired",
      in_progress: "verification pending",
      not_started: "verification pending",
      inconclusive: "manual review required",
      unable_to_verify: "source unavailable",
    };
    return docs.map((doc) => {
      const check = verifications.find((verification) => verification.document_id === doc.id);
      const verificationType = check?.verification_type.toLowerCase() ?? "";
      const method = verificationType.includes("qr")
        ? "QR"
        : verificationType.includes("signature")
          ? "signature"
          : verificationType.includes("reference")
            ? "reference number"
            : "Not recorded";
      return {
        docId: doc.id,
        docName: doc.file_name,
        docType: doc.document_type,
        source: check?.source || "Not checked",
        method,
        timestamp: check?.checked_at || "Pending",
        status: check ? statuses[check.status] ?? "manual review required" : "verification pending",
        reason: check ? String(check.result.reason ?? "Verification result recorded.") : "No source check has been recorded for this document.",
      };
    });
  }, [docs, verifications]);

  return (
    <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "16px 20px" }}>
      {/* Top Breadcrumb & Case Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#64748b" }}>
            <Link href="/officer" style={{ color: "#004792", textDecoration: "none", fontWeight: 600 }}>
              Queue
            </Link>
            <span>/</span>
            <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{app.application_number}</span>
            <span>/</span>
            <span style={{ textTransform: "capitalize" }}>{currentStatus.replaceAll("_", " ")}</span>
          </div>
          <h1 style={{ fontSize: "20px", fontWeight: 800, color: "#1a2530", margin: "4px 0 0" }}>
            {(app as unknown as { institutions?: { name?: string } })?.institutions?.name || "Institution"}
          </h1>
        </div>

        {/* Buttons: Assign to me, Download validation report (PDF) */}
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {role && ["scrutiny_officer", "regional_officer", "admin"].includes(role) && (
            <button
              onClick={() => void handleAssignToMe()}
              style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: "#ffffff",
              border: "1px solid #cbd5e1",
              borderRadius: "6px",
              padding: "6px 12px",
              fontSize: "12px",
              fontWeight: 600,
              color: "#334155",
              cursor: "pointer",
            }}
          >
              <UserCheck size={14} />
              <span>{assignedOfficer ? `Assigned (${assignedOfficer})` : "Assign to me"}</span>
            </button>
          )}

          <button
            onClick={() => void handleExportReport()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: "#004792",
              border: "none",
              borderRadius: "6px",
              padding: "6px 14px",
              fontSize: "12px",
              fontWeight: 600,
              color: "#ffffff",
              cursor: "pointer",
            }}
          >
            <Download size={14} />
            <span>Print / save validation report as PDF</span>
          </button>
        </div>
      </div>
      {exportError && <p className="review-error" role="alert">{exportError}</p>}

      {/* Case Outcome & Status Lifecycle Bar */}
      <section
        style={{
          background: "#ffffff",
          border: "1px solid #dcdad4",
          borderRadius: "8px",
          padding: "14px 18px",
          marginBottom: "16px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "12px" }}>
          <div>
            <span style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", letterSpacing: "0.5px" }}>
              STATUS LIFECYCLE
            </span>
            <div style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "4px", flexWrap: "wrap" }}>
              {LIFECYCLE_STEPS.map((step, idx) => {
                const isActive = currentStatus === step.id;
                return (
                  <React.Fragment key={step.id}>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: isActive ? 700 : 500,
                        padding: "2px 8px",
                        borderRadius: "10px",
                        background: isActive ? "#004792" : "#f1f5f9",
                        color: isActive ? "#ffffff" : "#64748b",
                      }}
                    >
                      {step.label}
                    </span>
                    {idx < LIFECYCLE_STEPS.length - 1 && <span style={{ color: "#cbd5e1", fontSize: "10px" }}>→</span>}
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* Outcome Choice Dropdown & Submit */}
          {role && ["scrutiny_officer", "regional_officer", "admin"].includes(role) && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#334155" }}>Officer Outcome:</span>
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as CaseOutcome)}
              style={{
                fontSize: "12px",
                padding: "5px 10px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                background: "#ffffff",
              }}
            >
              <option value="">Select Outcome…</option>
              <option value="clear">Clear (Approve without findings)</option>
              <option value="return_for_clarification">Return for clarification</option>
              <option value="refer_for_inspection">Refer for inspection</option>
            </select>
            <input
              type="text"
              placeholder="Officer outcome remarks (required)…"
              value={outcomeRemarks}
              onChange={(e) => setOutcomeRemarks(e.target.value)}
              style={{
                fontSize: "12px",
                padding: "5px 10px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                minWidth: "220px",
              }}
            />
            <button
              onClick={() => void handleCaseOutcome()}
              style={{
                fontSize: "12px",
                fontWeight: 600,
                padding: "5px 12px",
                background: "#059669",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              Record Outcome
            </button>
          </div>
          )}
        </div>
        {outcomeMessage && (
          <p style={{ margin: 0, fontSize: "12px", color: "#004792", fontWeight: 500 }}>{outcomeMessage}</p>
        )}
      </section>

      {/* Main Split-Pane Layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "16px",
          minHeight: "680px",
        }}
      >
        {/* LEFT PANE: Document & Evidence Bounding Boxes */}
        <section
          style={{
            background: "#ffffff",
            border: "1px solid #dcdad4",
            borderRadius: "10px",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Document Selector & Canvas Controls */}
          <div
            style={{
              padding: "10px 14px",
              background: "#f8fafc",
              borderBottom: "1px solid #e2e8f0",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "8px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <FileText size={15} color="#004792" />
              <select
                value={selectedDocId}
                onChange={(e) => {
                  setSelectedDocId(e.target.value);
                  setSelectedBox(null);
                }}
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  padding: "4px 8px",
                  background: "#ffffff",
                }}
              >
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.file_name} ({d.document_type.replaceAll("_", " ")})
                  </option>
                ))}
              </select>
            </div>
            <span style={{ fontSize: "11px", color: "#64748b", fontFamily: "monospace" }}>
              Page 1 of {selectedDoc?.page_count || 1}
            </span>
          </div>

          <div style={{ flex: 1, minHeight: "620px", position: "relative", background: "#525659" }}>
            {previewUrl ? (
              <>
                <iframe
                  title={selectedDoc ? `Preview of ${selectedDoc.file_name}` : "Document preview"}
                  src={`${previewUrl}#toolbar=0`}
                  style={{ width: "100%", height: "100%", minHeight: "620px", border: 0 }}
                />
                {selectedBox && (
                  <div
                    aria-label="Selected evidence location"
                    style={{
                      position: "absolute",
                      left: `${selectedBox[0] * 100}%`,
                      top: `${selectedBox[1] * 100}%`,
                      width: `${(selectedBox[2] - selectedBox[0]) * 100}%`,
                      height: `${(selectedBox[3] - selectedBox[1]) * 100}%`,
                      border: "2px solid #ef4444",
                      background: "rgba(239, 68, 68, 0.15)",
                      pointerEvents: "none",
                    }}
                  />
                )}
              </>
            ) : (
              <div style={{ color: "#fff", padding: "24px", fontSize: "13px" }}>
                {previewError || (selectedDoc ? "Loading private document…" : "No document selected.")}
              </div>
            )}
          </div>
        </section>

        {/* RIGHT PANE: 5 TABS */}
        <section
          style={{
            background: "#ffffff",
            border: "1px solid #dcdad4",
            borderRadius: "10px",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* 5 Right Side Tabs */}
          <div
            style={{
              display: "flex",
              borderBottom: "1px solid #e2e8f0",
              background: "#f8fafc",
              padding: "6px 8px 0",
              gap: "4px",
              flexWrap: "wrap",
            }}
          >
            {[
              { id: "claims", label: "Claims and Indicators" },
              { id: "verification", label: "Verification" },
              { id: "validity", label: "Validity" },
              { id: "history", label: "History" },
              { id: "notice", label: "Notice" },
            ].map((tab) => {
              const isCurrent = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as typeof activeTab)}
                  style={{
                    background: isCurrent ? "#ffffff" : "transparent",
                    color: isCurrent ? "#004792" : "#64748b",
                    border: isCurrent ? "1px solid #e2e8f0" : "none",
                    borderBottom: isCurrent ? "2px solid #004792" : "none",
                    padding: "7px 12px",
                    fontSize: "12px",
                    fontWeight: isCurrent ? 700 : 500,
                    borderRadius: "6px 6px 0 0",
                    cursor: "pointer",
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* TAB 1: CLAIMS AND INDICATORS */}
          {activeTab === "claims" && (
            <div style={{ padding: "16px", overflowY: "auto", flex: 1 }}>
              <div style={{ marginBottom: "12px" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "#64748b" }}>CLAIMS LEDGER</span>
                <p style={{ fontSize: "12px", color: "#64748b", margin: "2px 0 0" }}>
                  Extracted institutional claims and related indicators. Click any row to highlight evidence.
                </p>
              </div>

              {/* Claims List */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px" }}>
                {claimList.length === 0 && (
                  <p className="review-empty">No claims or extracted evidence are recorded for this application.</p>
                )}
                {claimList.map((claim) => {
                  const linkedFinding = findings.find((f) => f.finding_id === claim.finding_id || f.rule_id.includes(claim.field_key.toUpperCase()));
                  const evidenceValue = claim.evidence_fields[0]?.field_value;
                  const rawBox = claim.evidence_fields[0]?.bbox;
                  const evidenceBox =
                    Array.isArray(rawBox) &&
                    rawBox.length === 4 &&
                    rawBox.every((value) => typeof value === "number" && value >= 0 && value <= 1)
                      ? (rawBox as [number, number, number, number])
                      : null;
                  const statusColors = {
                    Supported: { bg: "#dcfce7", text: "#166534" },
                    Contradicted: { bg: "#fee2e2", text: "#991b1b" },
                    Unsupported: { bg: "#fef3c7", text: "#92400e" },
                    Expired: { bg: "#f1f5f9", text: "#475569" },
                  };
                  const colors = (claim.status && statusColors[claim.status as keyof typeof statusColors]) || { bg: "#f1f5f9", text: "#475569" };

                  return (
                    <div
                      key={claim.id}
                      onClick={() => {
                        const evidenceDocumentId = claim.evidence_fields[0]?.document_id;
                        if (typeof evidenceDocumentId === "string") setSelectedDocId(evidenceDocumentId);
                        setSelectedBox(evidenceBox);
                      }}
                      style={{
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px",
                        padding: "12px 14px",
                        background: linkedFinding ? "#fffbeb" : "#ffffff",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                        <strong style={{ fontSize: "13px", color: "#1e293b", textTransform: "capitalize" }}>
                          {claim.field_key.replaceAll("_", " ")}
                        </strong>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            padding: "2px 7px",
                            borderRadius: "10px",
                            background: colors.bg,
                            color: colors.text,
                          }}
                        >
                          {claim.status}
                        </span>
                      </div>
                      <p style={{ fontSize: "12px", color: "#475569", margin: "0 0 6px" }}>
                        Declared: <strong>{String(claim.claim_value)}</strong>
                      </p>
                      {evidenceValue !== undefined && (
                        <p style={{ fontSize: "12px", color: "#475569", margin: 0 }}>
                          Extracted: <strong>{String(evidenceValue)}</strong>
                        </p>
                      )}

                      {/* Attached Finding Card */}
                      {linkedFinding && (
                        <div
                          style={{
                            background: "#ffffff",
                            border: "1px solid #fde68a",
                            borderRadius: "6px",
                            padding: "8px 10px",
                            marginTop: "6px",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: "11px", fontWeight: 700, color: "#b45309" }}>
                              Indicator: {linkedFinding.rule_id}
                            </span>
                            <span
                              style={{
                                fontSize: "10px",
                                fontWeight: 700,
                                textTransform: "uppercase",
                                padding: "1px 5px",
                                borderRadius: "4px",
                                background: linkedFinding.status === "resolved" ? "#dcfce7" : "#fee2e2",
                                color: linkedFinding.status === "resolved" ? "#166534" : "#991b1b",
                              }}
                            >
                              {linkedFinding.status === "resolved" ? "Accepted" : linkedFinding.status}
                            </span>
                          </div>
                          <p style={{ fontSize: "11px", color: "#78350f", margin: "3px 0 8px" }}>
                            {linkedFinding.reason}
                          </p>

                          {/* Action Buttons: Accept / Dismiss / Request */}
                          <div style={{ display: "flex", gap: "6px" }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setActionModal({ finding: linkedFinding, action: "accept" });
                              }}
                              style={{
                                fontSize: "11px",
                                fontWeight: 600,
                                padding: "3px 8px",
                                borderRadius: "4px",
                                background: "#059669",
                                color: "#ffffff",
                                border: "none",
                                cursor: "pointer",
                              }}
                            >
                              Accept
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setActionModal({ finding: linkedFinding, action: "dismiss" });
                              }}
                              style={{
                                fontSize: "11px",
                                fontWeight: 600,
                                padding: "3px 8px",
                                borderRadius: "4px",
                                background: "#e2e8f0",
                                color: "#334155",
                                border: "none",
                                cursor: "pointer",
                              }}
                            >
                              Dismiss (remarks required)
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setActionModal({ finding: linkedFinding, action: "request" });
                              }}
                              style={{
                                fontSize: "11px",
                                fontWeight: 600,
                                padding: "3px 8px",
                                borderRadius: "4px",
                                background: "#004792",
                                color: "#ffffff",
                                border: "none",
                                cursor: "pointer",
                              }}
                            >
                              Request more evidence or inspection (remarks required)
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Anomaly Indicators Section Below */}
              <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: "14px" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "#64748b" }}>ANOMALY INDICATORS</span>
                <p style={{ fontSize: "12px", color: "#64748b", margin: "2px 0 10px" }}>
                  Document structure, cross-institution integrity, and font consistency indicators. Click row to highlight on document.
                </p>

                {anomalyFindings.length === 0 ? (
                  <p style={{ fontSize: "12px", color: "#64748b", fontStyle: "italic" }}>
                    No anomaly indicators are recorded for this application.
                  </p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {anomalyFindings.map((af) => (
                      <div
                        key={af.finding_id}
                        onClick={() => {
                          const bbox = af.evidence?.bbox;
                          setSelectedBox(
                            bbox && bbox.every((value) => value >= 0 && value <= 1) ? bbox : null
                          );
                          const documentId = af.document?.document_id;
                          if (typeof documentId === "string") setSelectedDocId(documentId);
                        }}
                        style={{
                          border: "1px solid #fed7aa",
                          background: "#fffaf0",
                          borderRadius: "6px",
                          padding: "10px",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <strong style={{ fontSize: "12px", color: "#9a3412" }}>{af.rule_id}</strong>
                          <span style={{ fontSize: "10px", fontWeight: 700, color: "#c2410c", textTransform: "uppercase" }}>
                            {af.severity}
                          </span>
                        </div>
                        <p style={{ fontSize: "11px", color: "#7c2d12", margin: "3px 0 6px" }}>{af.reason}</p>
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActionModal({ finding: af, action: "accept" });
                            }}
                            style={{ fontSize: "11px", fontWeight: 600, padding: "3px 8px", background: "#059669", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer" }}
                          >
                            Accept
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActionModal({ finding: af, action: "dismiss" });
                            }}
                            style={{ fontSize: "11px", fontWeight: 600, padding: "3px 8px", background: "#e2e8f0", color: "#334155", border: "none", borderRadius: "4px", cursor: "pointer" }}
                          >
                            Dismiss (remarks required)
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActionModal({ finding: af, action: "request" });
                            }}
                            style={{ fontSize: "11px", fontWeight: 600, padding: "3px 8px", background: "#004792", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer" }}
                          >
                            Request more evidence or inspection (remarks required)
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: VERIFICATION */}
          {activeTab === "verification" && (
            <div style={{ padding: "16px", overflowY: "auto", flex: 1 }}>
              <div style={{ marginBottom: "12px" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "#64748b" }}>SOURCE VERIFICATION</span>
                <p style={{ fontSize: "12px", color: "#64748b", margin: "2px 0 0" }}>
                  Automated verification per document with source, verification method, and timestamp.
                </p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {verificationList.map((v, i) => {
                  const statusColors: Record<string, { bg: string; text: string }> = {
                    verified: { bg: "#dcfce7", text: "#166534" },
                    "mismatch detected": { bg: "#fee2e2", text: "#991b1b" },
                    expired: { bg: "#fef3c7", text: "#92400e" },
                    "verification pending": { bg: "#e0f2fe", text: "#0369a1" },
                    "source unavailable": { bg: "#f1f5f9", text: "#475569" },
                    "manual review required": { bg: "#f3e8ff", text: "#6b21a8" },
                  };
                  const colors = statusColors[v.status] || { bg: "#f1f5f9", text: "#475569" };

                  return (
                    <div
                      key={i}
                      style={{
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px",
                        padding: "12px 14px",
                        background: "#ffffff",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                        <strong style={{ fontSize: "13px", color: "#1e293b" }}>{v.docName}</strong>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            padding: "2px 8px",
                            borderRadius: "10px",
                            background: colors.bg,
                            color: colors.text,
                            textTransform: "capitalize",
                          }}
                        >
                          {v.status}
                        </span>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", fontSize: "11px", color: "#64748b", margin: "4px 0" }}>
                        <div>Source: <strong>{v.source}</strong></div>
                        <div>Method: <strong>{v.method.toUpperCase()}</strong></div>
                        <div style={{ gridColumn: "span 2" }}>
                          Timestamp: <strong>{new Date(v.timestamp).toLocaleString()}</strong>
                        </div>
                      </div>

                      <p style={{ fontSize: "12px", color: "#334155", margin: "4px 0 0", background: "#f8fafc", padding: "6px 8px", borderRadius: "4px" }}>
                        {v.reason}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: VALIDITY */}
          {activeTab === "validity" && (
            <div style={{ padding: "16px", overflowY: "auto", flex: 1 }}>
              <div style={{ marginBottom: "12px" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "#64748b" }}>VALIDITY TIMELINE</span>
                <p style={{ fontSize: "12px", color: "#64748b", margin: "2px 0 0" }}>
                  Statutory expiry dates across Fire NOCs, Building Plans, and Land Leases for this application.
                </p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {docs.length === 0 && <p className="review-empty">No documents are recorded for this application.</p>}
                {docs.map((doc) => {
                  const expiryField = fields.find(
                    (field) =>
                      field.document_id === doc.id &&
                      (field.field_key === "valid_until" || field.field_key.endsWith("_expiry_date"))
                  );
                  const expiry = expiryField ? String(expiryField.field_value) : null;
                  const expiryDate = expiry ? new Date(expiry) : null;
                  const isExpired = expiryDate !== null && Number.isFinite(expiryDate.getTime()) && expiryDate.getTime() < Date.now();

                  return (
                    <div
                      key={doc.id}
                      style={{
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px",
                        padding: "12px 14px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        background: isExpired ? "#fffbeb" : "#ffffff",
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: "13px", color: "#1e293b", display: "block" }}>
                          {doc.file_name}
                        </strong>
                        <span style={{ fontSize: "11px", color: "#64748b" }}>
                          Type: {doc.document_type.replaceAll("_", " ")}
                        </span>
                      </div>

                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "11px", color: "#64748b" }}>Valid Until</div>
                        <strong style={{ fontSize: "13px", color: isExpired ? "#b45309" : "#334155" }}>
                          {expiry || "Not extracted"}
                        </strong>
                        {isExpired && (
                          <div style={{ fontSize: "10px", fontWeight: 700, color: "#dc2626" }}>
                            Expired
                          </div>
                        )}
                        {!expiry && (
                          <div style={{ fontSize: "10px", fontWeight: 700, color: "#64748b" }}>
                            Manual review required
                          </div>
                        )}
                        {expiryDate && Number.isFinite(expiryDate.getTime()) && (
                          <div style={{ fontSize: "10px", color: "#64748b" }}>
                            {Math.ceil((expiryDate.getTime() - Date.now()) / 86_400_000)} days
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 4: HISTORY */}
          {activeTab === "history" && (
            <div style={{ padding: "16px", overflowY: "auto", flex: 1 }}>
              <div style={{ marginBottom: "12px" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "#64748b" }}>APPLICATION AUDIT TRAIL</span>
                <p style={{ fontSize: "12px", color: "#64748b", margin: "2px 0 0" }}>
                  Chronological hash-chained record of all actions taken on this application.
                </p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {historyLoading && <p>Loading case history…</p>}
                {!historyLoading && historyError && <p className="review-error" role="alert">{historyError}</p>}
                {!historyLoading && !historyError && caseAuditRows.length === 0 && <p className="review-empty">No recorded case actions yet.</p>}
                {caseAuditRows.map((entry) => (
                  <div
                    key={entry.id}
                    style={{
                      borderLeft: "3px solid #004792",
                      background: "#f8fafc",
                      padding: "10px 12px",
                      borderRadius: "0 6px 6px 0",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <strong style={{ fontSize: "12px", color: "#1e293b" }}>{entry.action}</strong>
                      <span style={{ fontSize: "10px", color: "#64748b" }}>
                        {new Date(entry.occurred_at).toLocaleString()}
                      </span>
                    </div>
                    <div style={{ fontSize: "11px", color: "#475569", marginTop: "2px", fontFamily: "monospace" }}>
                      Hash: {entry.hash.slice(0, 16)}…
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 5: NOTICE */}
          {activeTab === "notice" && (
            <div style={{ padding: "16px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <div>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "#64748b" }}>DEFICIENCY NOTICE DRAFT</span>
                  <p style={{ fontSize: "12px", color: "#64748b", margin: "2px 0 0" }}>
                    Assembles only accepted findings into an official statutory notice.
                  </p>
                </div>

                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    onClick={() => void handleCreateNoticeDraft()}
                    disabled={noticeBusy || acceptedFindings.length === 0}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      background: "#004792",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "6px",
                      padding: "6px 12px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    <FileText size={13} />
                    <span>{noticeBusy ? "Saving…" : `Draft notice (${acceptedFindings.length} accepted)`}</span>
                  </button>

                  {/* Language Toggle */}
                  <div style={{ display: "flex", gap: "4px", background: "#f1f5f9", padding: "2px", borderRadius: "6px" }}>
                    <button
                      onClick={() => {
                        setNoticeLanguage("en");
                        setNoticeId(null);
                        setNoticeApproved(false);
                        handleDraftNotice("en");
                      }}
                      style={{
                        padding: "4px 8px",
                        fontSize: "11px",
                        fontWeight: noticeLanguage === "en" ? 700 : 500,
                        background: noticeLanguage === "en" ? "#ffffff" : "transparent",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      English
                    </button>
                    <button
                      onClick={() => {
                        setNoticeLanguage("hi");
                        setNoticeId(null);
                        setNoticeApproved(false);
                        handleDraftNotice("hi");
                      }}
                      style={{
                        padding: "4px 8px",
                        fontSize: "11px",
                        fontWeight: noticeLanguage === "hi" ? 700 : 500,
                        background: noticeLanguage === "hi" ? "#ffffff" : "transparent",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      हिन्दी
                    </button>
                  </div>
                </div>
              </div>

              {noticeLanguage === "hi" && (
                <div
                  style={{
                    background: "#fef3c7",
                    border: "1px solid #fde68a",
                    padding: "6px 10px",
                    borderRadius: "6px",
                    fontSize: "11px",
                    color: "#92400e",
                    marginBottom: "10px",
                  }}
                >
                  Hindi text—review before sending.
                </div>
              )}

              {/* Editable Notice Content */}
              <textarea
                rows={12}
                value={noticeContent}
                onChange={(e) => setNoticeContent(e.target.value)}
                readOnly={noticeApproved}
                style={{
                  width: "100%",
                  flex: 1,
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  padding: "10px 12px",
                  fontSize: "12px",
                  fontFamily: noticeLanguage === "hi" ? "'Noto Sans Devanagari', sans-serif" : "inherit",
                  lineHeight: 1.5,
                  marginBottom: "12px",
                }}
              />

              {/* Notice Action Bar */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <button
                  onClick={() => window.print()}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    background: "#ffffff",
                    border: "1px solid #cbd5e1",
                    borderRadius: "6px",
                    padding: "6px 12px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <Printer size={14} />
                  <span>Print / save PDF</span>
                </button>

                {!noticeApproved && (
                  <input
                    aria-label="Notice approval remarks"
                    value={noticeApprovalRemarks}
                    onChange={(event) => setNoticeApprovalRemarks(event.target.value)}
                    placeholder="Approval remarks required"
                  />
                )}
                <button
                  onClick={() => void handleApproveNotice()}
                  disabled={noticeBusy || !noticeId || !noticeApprovalRemarks.trim() || noticeApproved}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    background: "#004792",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "6px",
                    padding: "8px 16px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <Send size={14} />
                  <span>{noticeBusy ? "Approving…" : "Approve & Deliver Notice"}</span>
                </button>
              </div>

              {noticeMessage && (
                <div style={{ marginTop: "10px", fontSize: "12px", color: "#059669", fontWeight: 600 }}>
                  ✓ {noticeMessage}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Finding Review Action Modal */}
      {actionModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "480px",
              background: "#ffffff",
              borderRadius: "10px",
              padding: "20px",
              boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
            }}
          >
            <h3 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 8px", color: "#1e293b" }}>
              {actionModal.action === "accept"
                ? "Accept Indicator"
                : actionModal.action === "dismiss"
                ? "Dismiss Indicator (Remarks Required)"
                : "Request More Evidence or Inspection (Remarks Required)"}
            </h3>
            <p style={{ fontSize: "12px", color: "#64748b", margin: "0 0 12px" }}>
              Indicator: <strong>{actionModal.finding.rule_id}</strong> — {actionModal.finding.reason}
            </p>

            <label style={{ fontSize: "12px", fontWeight: 600, color: "#334155", display: "block", marginBottom: "4px" }}>
              Officer Remarks {actionModal.action !== "accept" && <span style={{ color: "#dc2626" }}>*</span>}
            </label>
            <textarea
              rows={3}
              placeholder="Enter justification or specific records requested…"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              style={{
                width: "100%",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                padding: "8px 10px",
                fontSize: "12px",
                marginBottom: "12px",
              }}
            />

            {actionMessage && (
              <p style={{ fontSize: "12px", color: actionMessage.includes("success") ? "#059669" : "#dc2626", margin: "0 0 10px" }}>
                {actionMessage}
              </p>
            )}

            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setActionModal(null)}
                style={{
                  background: "transparent",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  padding: "6px 12px",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleFindingAction()}
                disabled={actionBusy}
                style={{
                  background: "#004792",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "6px",
                  padding: "6px 14px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {actionBusy ? "Recording…" : "Confirm Action"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mandatory Footer Note */}
      <footer
        style={{
          marginTop: "24px",
          textAlign: "center",
          fontSize: "12px",
          color: "#64748b",
          fontStyle: "italic",
        }}
      >
        Indicators for human review, not decisions.
      </footer>
    </div>
  );
}
