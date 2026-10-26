"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  Building2,
  FileText,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Plus,
  ArrowLeft,
  ChevronRight,
  ShieldCheck,
  Mail,
  Send,
  Clock,
  Sparkles,
  Info,
} from "lucide-react";
import type { ApplicationRow, DocumentRow } from "./review-workspace";
import type { Finding, RuleData, PreCheckResult, NoticeRecord } from "@/lib/models";
import { getSupabaseClient } from "@/lib/supabase";

interface ApplicantWorkspaceProps {
  apps: ApplicationRow[];
  docs: DocumentRow[];
  findings: Finding[];
  config: RuleData | null;
  loading: boolean;
  onRefresh?: () => Promise<void> | void;
}

const APP_TYPES = [
  {
    id: "new_institution",
    title: "New Technical Institution",
    desc: "Complete establishment approval for newly founded institutions.",
    badge: "Full Approval",
  },
  {
    id: "renewal",
    title: "Extension of Approval (EOA)",
    desc: "Annual statutory continuation of approval for existing institutions.",
    badge: "Annual Renewal",
  },
  {
    id: "increase_in_intake",
    title: "Increase in Intake",
    desc: "Capacity expansion for sanctioned programs and divisions.",
    badge: "Expansion",
  },
  {
    id: "new_program",
    title: "New Program / Degree",
    desc: "Introduction of new technical courses or specialized divisions.",
    badge: "New Discipline",
  },
];

const CHECKLIST_METADATA: Record<string, { title: string; desc: string }> = {
  application_form: {
    title: "AICTE Application Form",
    desc: "Signed statutory application with institutional profile and governance declaration.",
  },
  affidavit: {
    title: "Notarized Institutional Affidavit",
    desc: "Sworn affidavit on non-judicial stamp paper attested by notary.",
  },
  fire_noc: {
    title: "Municipal Fire Safety Certificate (Fire NOC)",
    desc: "Valid statutory clearance issued by municipal or state fire authority.",
  },
  lease: {
    title: "Land Title / Registered Lease Deed",
    desc: "Registered sale or 30-year lease deed showing clear institutional possession.",
  },
  accreditation_letter: {
    title: "University Affiliation / Accreditation",
    desc: "State university affiliation and NBA/NAAC accreditation orders.",
  },
  structural_certificate: {
    title: "Structural Stability Certificate",
    desc: "Certified stability and load compliance by licensed structural engineer.",
  },
  ter_receipt: {
    title: "TER Fee Payment Receipt",
    desc: "Payment receipt confirming Technical Education Regulatory fee deposit.",
  },
  building_plan: {
    title: "Sanctioned Building Plan & FSI Clearance",
    desc: "Architect-certified floor plan with approved FAR/FSI and built-up area.",
  },
  faculty_record: {
    title: "Faculty Cadre & Cadre Ratio Record",
    desc: "Sanctioned faculty rolls with qualification proof and cadre ratios.",
  },
};

export function ApplicantWorkspace({
  apps,
  docs,
  findings,
  config,
  loading,
  onRefresh,
}: ApplicantWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<"applications" | "notices">("applications");
  const [currentAppId, setCurrentAppId] = useState<string | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");

  // Workspace form state
  const [selectedType, setSelectedType] = useState<string>("new_institution");
  const [academicYear, setAcademicYear] = useState<string>(() => {
    const now = new Date();
    const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
  });
  const [appNumber, setAppNumber] = useState<string>("");

  // Document upload & pre-check states: doc_type -> PreCheckResult
  const [docChecks, setDocChecks] = useState<Record<string, PreCheckResult>>({});
  const [checkingDocs, setCheckingDocs] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Notices state
  const [notices, setNotices] = useState<NoticeRecord[]>([]);
  const [noticesLoading, setNoticesLoading] = useState(true);
  const [noticesError, setNoticesError] = useState("");
  const [selectedNotice, setSelectedNotice] = useState<NoticeRecord | null>(null);
  const [responseRemarks, setResponseRemarks] = useState("");
  const [recheckDiff, setRecheckDiff] = useState<{ resolved: string[]; still_open: string[]; new_issues: string[] } | null>(null);
  const [recheckBusy, setRecheckBusy] = useState(false);
  const [recheckError, setRecheckError] = useState("");

  // Load notices from Supabase
  useEffect(() => {
    const client = getSupabaseClient();
    async function loadNotices() {
      setNoticesLoading(true);
      setNoticesError("");
      if (!client) {
        setNotices([]);
        setNoticesError("Supabase is not configured.");
        setNoticesLoading(false);
        return;
      }
      const { data, error } = await client
        .from("deficiency_letters")
        .select("id, application_id, language, content, finding_ids, status, created_at, approved_at, approval_remarks")
        .order("created_at", { ascending: false });
      if (error) {
        setNotices([]);
        setNoticesError(error.message);
      } else {
        setNotices((data ?? []) as unknown as NoticeRecord[]);
      }
      setNoticesLoading(false);
    }
    void loadNotices();
    if (!client) return;
    const channel = client
      .channel("applicant-notices")
      .on("postgres_changes", { event: "*", schema: "public", table: "deficiency_letters" }, () => {
        void loadNotices();
      })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, []);

  // When selecting an existing application to view in workspace
  const activeApp = useMemo(() => {
    return apps.find((a) => a.id === currentAppId) || null;
  }, [apps, currentAppId]);

  // Determine required documents for the chosen application type
  const requiredDocs = useMemo(() => {
    const typeKey = activeApp ? activeApp.application_type : selectedType;
    const checklist = config?.checklists?.[typeKey] ?? config?.checklists?.new_institution;
    const docsList = checklist?.required_documents ?? [
      "application_form",
      "affidavit",
      "fire_noc",
      "lease",
      "accreditation_letter",
      "structural_certificate",
      "ter_receipt",
    ];
    return docsList;
  }, [config, activeApp, selectedType]);

  // Sync existing documents and findings into docChecks when an app is opened
  useEffect(() => {
    if (!activeApp) return;
    const appDocs = docs.filter((d) => d.application_id === activeApp.id);
    const appFindings = findings.filter((f) => f.application_id === activeApp.id);

    const initial: Record<string, PreCheckResult> = {};
    for (const docKey of requiredDocs) {
      const matchDoc = appDocs.find((d) => d.document_type === docKey || d.file_name.toLowerCase().includes(docKey));
      if (!matchDoc) {
        // Document not yet uploaded
        continue;
      }
      // Check if there is an open finding for this document
      const finding = appFindings.find((f) => {
        const docName = String((f.document as { name?: string })?.name ?? "").toLowerCase();
        return docName.includes(docKey) || docName.includes(matchDoc.file_name.toLowerCase());
      });

      if (finding && (finding.status === "open" || finding.status === "under_review")) {
        initial[docKey] = {
          document_type: docKey,
          file_name: matchDoc.file_name,
          status: "needs_fixing",
          reason: finding.reason,
          blocker: true,
          rule_id: finding.rule_id,
        };
      } else {
        const savedCheck = matchDoc.metadata?.precheck as PreCheckResult | undefined;
        initial[docKey] = savedCheck
          ? { ...savedCheck, file_name: matchDoc.file_name }
          : {
              document_type: docKey,
              file_name: matchDoc.file_name,
              status: "checking",
              reason: "No completed pre-check is recorded for this document.",
              blocker: true,
            };
      }
    }
    setDocChecks(initial);
  }, [activeApp, docs, findings, requiredDocs]);

  // Compute live readiness score
  const readiness = useMemo(() => {
    if (!requiredDocs.length) return { score: 100, blockers: [] };
    const blockers: string[] = [];
    let goodCount = 0;

    for (const docKey of requiredDocs) {
      const check = docChecks[docKey];
      const meta = CHECKLIST_METADATA[docKey] || { title: docKey.replaceAll("_", " ") };
      if (!check) {
        blockers.push(`Upload required document: ${meta.title}`);
      } else if (check.status === "needs_fixing") {
        blockers.push(`${meta.title}: ${check.reason}`);
      } else if (check.status === "looks_good") {
        goodCount += 1;
      } else {
        blockers.push(`${meta.title}: automated check is still running.`);
      }
    }

    const score = Math.round((goodCount / requiredDocs.length) * 100);
    return { score, blockers };
  }, [requiredDocs, docChecks]);

  // Handle instant document upload & live pre-check
  const handleFileUpload = useCallback(
    async (docType: string, file: File) => {
      const applicationId = activeApp?.id ?? currentAppId;
      if (!applicationId) {
        setWorkspaceError("Create or select an application before uploading documents.");
        return;
      }
      setCheckingDocs((prev) => ({ ...prev, [docType]: true }));
      setWorkspaceError("");
      const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:7860").replace(/\/$/, "");

      try {
        const supabase = getSupabaseClient();
        const { data: sessionData, error: sessionError } = await supabase?.auth.getSession() ?? { data: { session: null }, error: null };
        if (sessionError || !sessionData.session) throw new Error("Sign in to upload a document.");
        const formData = new FormData();
        formData.set("application_id", applicationId);
        formData.set("document_type", docType);
        formData.set("file", file);
        const response = await fetch(`${apiUrl}/applicant/upload`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${sessionData.session.access_token}`,
          },
          body: formData,
        });

        const responseBody = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(responseBody.detail || "Document upload or pre-check could not be completed.");
        const result = responseBody as PreCheckResult;
        setDocChecks((prev) => ({
          ...prev,
          [docType]: {
            ...result,
            file_name: file.name,
          },
        }));
        if (onRefresh) await onRefresh();
      } catch (error) {
        setWorkspaceError(error instanceof Error ? error.message : "Document upload failed.");
      } finally {
        setCheckingDocs((prev) => ({ ...prev, [docType]: false }));
      }
    },
    [activeApp, currentAppId, onRefresh]
  );

  // Submit application handler
  const handleSubmitApplication = async () => {
    if (readiness.blockers.length > 0 || !activeApp) return;
    setSubmitting(true);
    setWorkspaceError("");
    try {
      const supabase = getSupabaseClient();
      const { data: sessionData, error: sessionError } = await supabase?.auth.getSession() ?? { data: { session: null }, error: null };
      if (sessionError || !sessionData.session) throw new Error("Sign in to submit this application.");
      const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:7860").replace(/\/$/, "");
      const response = await fetch(`${apiUrl}/applicant/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({ application_id: activeApp.id }),
      });
      const responseBody = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseBody.detail || "Application could not be submitted.");
      setSubmitSuccess(true);
      if (onRefresh) await onRefresh();
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "Application could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateDraft = async () => {
    setDraftBusy(true);
    setWorkspaceError("");
    try {
      const supabase = getSupabaseClient();
      const { data: sessionData, error: sessionError } = await supabase?.auth.getSession() ?? { data: { session: null }, error: null };
      if (sessionError || !sessionData.session) throw new Error("Sign in to create an application.");
      const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:7860").replace(/\/$/, "");
      const response = await fetch(`${apiUrl}/applicant/drafts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({ application_type: selectedType, academic_year: academicYear }),
      });
      const responseBody = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseBody.detail || "Application draft could not be created.");
      const draft = responseBody as { id?: string };
      if (!draft.id) throw new Error("The server did not return the new application.");
      setAppNumber("");
      setCurrentAppId(draft.id);
      setIsCreatingNew(false);
      setDocChecks({});
      if (onRefresh) await onRefresh();
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "Application draft could not be created.");
    } finally {
      setDraftBusy(false);
    }
  };

  // Re-check handler for notices tab
  const handleNoticeResponse = async (docType: string, file: File) => {
    setRecheckBusy(true);
    setRecheckError("");
    const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:7860").replace(/\/$/, "");

    try {
      const supabase = getSupabaseClient();
      const { data: sessionData, error: sessionError } = await supabase?.auth.getSession() ?? { data: { session: null }, error: null };
      if (sessionError || !sessionData.session) throw new Error("Sign in to respond to this notice.");
      const response = await fetch(`${apiUrl}/applicant/recheck-notice`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({
          application_id: selectedNotice?.application_id || "",
          notice_id: selectedNotice?.id || "",
          document_type: docType,
          file_name: file.name,
          explanation: responseRemarks,
        }),
      });

      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || "The re-check could not be completed.");
      setRecheckDiff((await response.json()) as { resolved: string[]; still_open: string[]; new_issues: string[] });
    } catch (error) {
      setRecheckDiff(null);
      setRecheckError(error instanceof Error ? error.message : "The re-check could not be completed.");
    } finally {
      setRecheckBusy(false);
    }
  };

  // RENDER: Workspace Mode (Step-by-step application builder)
  if (currentAppId || isCreatingNew) {
    return (
      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "20px 16px" }}>
        {/* Back Link */}
        <button
          onClick={() => {
            setCurrentAppId(null);
            setIsCreatingNew(false);
            setSubmitSuccess(false);
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            background: "none",
            border: "none",
            color: "#455468",
            fontSize: "13px",
            fontWeight: 500,
            cursor: "pointer",
            marginBottom: "16px",
          }}
        >
          <ArrowLeft size={15} />
          <span>Back to My Applications</span>
        </button>

        {/* Application Header Card */}
        <header
          style={{
            background: "#ffffff",
            border: "1px solid #dcdad4",
            borderRadius: "10px",
            padding: "20px 24px",
            marginBottom: "24px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "16px",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#004792", letterSpacing: "0.5px" }}>
                APPLICATION WORKSPACE
              </span>
              <span
                style={{
                  background: activeApp?.status === "submitted" ? "#ecfdf5" : "#f1f5f9",
                  color: activeApp?.status === "submitted" ? "#065f46" : "#475569",
                  fontSize: "11px",
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: "12px",
                  textTransform: "capitalize",
                }}
              >
                {activeApp?.status ? activeApp.status.replaceAll("_", " ") : "Draft"}
              </span>
            </div>
            <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#1a2530", margin: 0 }}>
              {activeApp ? activeApp.application_number : appNumber || "New AICTE Application"}
            </h1>
            <p style={{ fontSize: "13px", color: "#64748b", margin: "4px 0 0" }}>
              Academic Year {activeApp ? activeApp.academic_year : academicYear} ·{" "}
              {(activeApp?.application_type || selectedType).replaceAll("_", " ").toUpperCase()}
            </p>
          </div>

          {/* Readiness Gauge */}
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#64748b" }}>READINESS SCORE</div>
              <div
                style={{
                  fontSize: "26px",
                  fontWeight: 800,
                  color: readiness.score === 100 ? "#059669" : readiness.score >= 70 ? "#d97706" : "#dc2626",
                }}
              >
                {readiness.score}%
              </div>
            </div>
            <div
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "50%",
                background: `conic-gradient(${
                  readiness.score === 100 ? "#10b981" : readiness.score >= 70 ? "#f59e0b" : "#ef4444"
                } ${readiness.score * 3.6}deg, #e2e8f0 0deg)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  width: "44px",
                  height: "44px",
                  borderRadius: "50%",
                  background: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "12px",
                  fontWeight: 700,
                }}
              >
                {readiness.score}%
              </div>
            </div>
          </div>
        </header>

        {submitSuccess && (
          <div
            style={{
              background: "#ecfdf5",
              border: "1px solid #10b981",
              borderRadius: "8px",
              padding: "16px 20px",
              marginBottom: "24px",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              color: "#065f46",
            }}
          >
            <CheckCircle2 size={20} color="#059669" />
            <div>
              <strong style={{ fontSize: "14px" }}>Application Submitted Successfully</strong>
              <p style={{ margin: "2px 0 0", fontSize: "13px" }}>
                Your records have been submitted for AICTE automated checking and scrutiny review. You can track status
                updates here.
              </p>
            </div>
          </div>
        )}

        {workspaceError && <p className="review-error" role="alert">{workspaceError}</p>}

        {/* Step 1: Pick Application Type */}
        <section
          style={{
            background: "#ffffff",
            border: "1px solid #dcdad4",
            borderRadius: "10px",
            padding: "20px 24px",
            marginBottom: "20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
            <span
              style={{
                width: "22px",
                height: "22px",
                borderRadius: "50%",
                background: "#004792",
                color: "#ffffff",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "12px",
                fontWeight: 700,
              }}
            >
              1
            </span>
            <h2 style={{ fontSize: "15px", fontWeight: 700, color: "#1a2530", margin: 0 }}>
              Select Application Type
            </h2>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: "12px",
            }}
          >
            {APP_TYPES.map((type) => {
              const isSelected = (activeApp ? activeApp.application_type : selectedType) === type.id;
              return (
                <div
                  key={type.id}
                  onClick={() => !activeApp && setSelectedType(type.id)}
                  style={{
                    border: isSelected ? "2px solid #004792" : "1px solid #e2e8f0",
                    background: isSelected ? "#f8fafc" : "#ffffff",
                    borderRadius: "8px",
                    padding: "14px 16px",
                    cursor: activeApp ? "default" : "pointer",
                    position: "relative",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "#004792" }}>{type.badge}</span>
                    {isSelected && <CheckCircle2 size={16} color="#004792" />}
                  </div>
                  <strong style={{ fontSize: "13px", color: "#1e293b", display: "block", marginBottom: "4px" }}>
                    {type.title}
                  </strong>
                  <p style={{ fontSize: "12px", color: "#64748b", margin: 0, lineHeight: 1.4 }}>{type.desc}</p>
                </div>
              );
            })}
          </div>
          {!activeApp && (
            <button
              type="button"
              onClick={() => void handleCreateDraft()}
              disabled={draftBusy}
              style={{ marginTop: "14px", padding: "8px 14px", border: 0, borderRadius: "6px", background: "#004792", color: "#fff", fontWeight: 600, cursor: draftBusy ? "wait" : "pointer" }}
            >
              {draftBusy ? "Creating draft…" : "Save draft and continue"}
            </button>
          )}
        </section>

        {/* Step 2, 3, 4: Document Checklist & Instant Pre-checks */}
        <section
          style={{
            background: "#ffffff",
            border: "1px solid #dcdad4",
            borderRadius: "10px",
            padding: "20px 24px",
            marginBottom: "20px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  width: "22px",
                  height: "22px",
                  borderRadius: "50%",
                  background: "#004792",
                  color: "#ffffff",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "12px",
                  fontWeight: 700,
                }}
              >
                2
              </span>
              <div>
                <h2 style={{ fontSize: "15px", fontWeight: 700, color: "#1a2530", margin: 0 }}>
                  Required Document Checklist & Instant Pre-Checks
                </h2>
                <p style={{ fontSize: "12px", color: "#64748b", margin: "2px 0 0" }}>
                  Upload each statutory document to receive instant automated validation.
                </p>
              </div>
            </div>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#475569" }}>
              {Object.values(docChecks).filter((c) => c.status === "looks_good").length} of {requiredDocs.length} Verified
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {requiredDocs.map((docKey: string) => {
              const meta = CHECKLIST_METADATA[docKey] || {
                title: docKey.replaceAll("_", " "),
                desc: "Statutory institutional record.",
              };
              const check = docChecks[docKey];
              const isChecking = checkingDocs[docKey];

              return (
                <div
                  key={docKey}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    padding: "14px 16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: "12px",
                    background:
                      check?.status === "looks_good"
                        ? "#f0fdf4"
                        : check?.status === "needs_fixing"
                        ? "#fffbeb"
                        : "#ffffff",
                  }}
                >
                  <div style={{ flex: 1, minWidth: "260px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" }}>
                      <strong style={{ fontSize: "13px", color: "#1e293b" }}>{meta.title}</strong>
                      {check && (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            fontSize: "11px",
                            fontWeight: 700,
                            padding: "2px 7px",
                            borderRadius: "10px",
                            background: check.status === "looks_good" ? "#dcfce7" : "#fee2e2",
                            color: check.status === "looks_good" ? "#166534" : "#991b1b",
                          }}
                        >
                          {check.status === "looks_good" ? (
                            <>
                              <CheckCircle2 size={12} /> Looks good
                            </>
                          ) : (
                            <>
                              <AlertTriangle size={12} /> Needs fixing
                            </>
                          )}
                        </span>
                      )}
                      {isChecking && (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            fontSize: "11px",
                            fontWeight: 600,
                            padding: "2px 7px",
                            borderRadius: "10px",
                            background: "#e0f2fe",
                            color: "#0369a1",
                          }}
                        >
                          <Loader2 size={12} className="spin" /> Checking…
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: "12px", color: "#64748b", margin: 0, lineHeight: 1.35 }}>
                      {check?.reason || meta.desc}
                    </p>
                    {check?.file_name && (
                      <span
                        style={{
                          fontSize: "11px",
                          fontFamily: "monospace",
                          color: "#475569",
                          marginTop: "4px",
                          display: "inline-block",
                        }}
                      >
                        File: {check.file_name}
                      </span>
                    )}
                  </div>

                  {/* Upload input button */}
                  <div>
                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        background: "#ffffff",
                        border: "1px solid #cbd5e1",
                        padding: "6px 12px",
                        borderRadius: "6px",
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "#334155",
                        cursor: "pointer",
                      }}
                    >
                      <UploadCloud size={14} />
                      <span>{check ? "Re-upload" : "Upload Document"}</span>
                      <input
                        type="file"
                        accept=".pdf"
                        disabled={!activeApp || checkingDocs[docKey]}
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handleFileUpload(docKey, file);
                        }}
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Step 5: Fix Before Submitting List */}
        <section
          style={{
            background: "#ffffff",
            border: "1px solid #dcdad4",
            borderRadius: "10px",
            padding: "20px 24px",
            marginBottom: "20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
            <span
              style={{
                width: "22px",
                height: "22px",
                borderRadius: "50%",
                background: "#004792",
                color: "#ffffff",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "12px",
                fontWeight: 700,
              }}
            >
              3
            </span>
            <h2 style={{ fontSize: "15px", fontWeight: 700, color: "#1a2530", margin: 0 }}>
              Fix Before Submitting
            </h2>
          </div>

          {readiness.blockers.length === 0 ? (
            <div
              style={{
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: "8px",
                padding: "14px 16px",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                color: "#166534",
              }}
            >
              <CheckCircle2 size={18} color="#16a34a" />
              <div>
                <strong style={{ fontSize: "13px" }}>All Blockers Resolved</strong>
                <p style={{ margin: "2px 0 0", fontSize: "12px" }}>
                  Required PDFs are readable. Document details still require officer verification.
                </p>
              </div>
            </div>
          ) : (
            <div
              style={{
                background: "#fffbeb",
                border: "1px solid #fde68a",
                borderRadius: "8px",
                padding: "14px 16px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", color: "#92400e" }}>
                <AlertTriangle size={16} />
                <strong style={{ fontSize: "13px" }}>
                  {readiness.blockers.length} {readiness.blockers.length === 1 ? "Blocker" : "Blockers"} Must Be Resolved
                </strong>
              </div>
              <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "12px", color: "#78350f", lineHeight: 1.6 }}>
                {readiness.blockers.map((b, idx) => (
                  <li key={idx}>{b}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Step 6: Submission Action with Guard */}
        <section
          style={{
            background: "#ffffff",
            border: "1px solid #dcdad4",
            borderRadius: "10px",
            padding: "20px 24px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "16px",
          }}
        >
          <div>
            <strong style={{ fontSize: "14px", color: "#1e293b", display: "block" }}>
              Final Statutory Submission
            </strong>
            <p style={{ fontSize: "12px", color: "#64748b", margin: "2px 0 0" }}>
              {readiness.blockers.length > 0
                ? "Submit is disabled until all blockers are resolved and all documents pass pre-checks."
                : "Submit now to lock records and transfer to the scrutiny officer review queue."}
            </p>
          </div>

          <button
            onClick={() => void handleSubmitApplication()}
            disabled={readiness.blockers.length > 0 || submitting || !activeApp || activeApp.status === "submitted"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              background:
                readiness.blockers.length > 0 || !activeApp || activeApp.status === "submitted"
                  ? "#94a3b8"
                  : "#059669",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              padding: "10px 20px",
              fontSize: "13px",
              fontWeight: 600,
              cursor:
                readiness.blockers.length > 0 || !activeApp || activeApp.status === "submitted"
                  ? "not-allowed"
                  : "pointer",
              transition: "background 0.2s ease",
            }}
          >
            {submitting ? (
              <>
                <Loader2 size={16} className="spin" /> Submitting…
              </>
            ) : activeApp?.status === "submitted" ? (
              <>
                <CheckCircle2 size={16} /> Submitted
              </>
            ) : (
              <>
                <Send size={15} /> Submit Application
              </>
            )}
          </button>
        </section>
      </div>
    );
  }

  // RENDER: My Applications List + Notices Tabs View
  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "20px 16px" }}>
      {/* Page Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "16px",
          marginBottom: "20px",
        }}
      >
        <div>
          <span style={{ fontSize: "11px", fontWeight: 700, color: "#004792", letterSpacing: "0.5px" }}>
            INSTITUTION PORTAL
          </span>
          <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#1a2530", margin: "2px 0 0" }}>
            Application Management
          </h1>
          <p style={{ fontSize: "13px", color: "#64748b", margin: "4px 0 0" }}>
            Submit new institutional proposals, review automated pre-checks, and respond to deficiency notices.
          </p>
        </div>

        <button
          onClick={() => {
            setCurrentAppId(null);
            setIsCreatingNew(true);
            setAppNumber("");
            setDocChecks({});
            setWorkspaceError("");
          }}
          disabled={draftBusy}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            background: "#004792",
            color: "#ffffff",
            border: "none",
            borderRadius: "6px",
            padding: "9px 16px",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <Plus size={16} />
          <span>New Application</span>
        </button>
      </div>

      {/* Primary Tab Bar: My Applications / Notices */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          borderBottom: "1px solid #dcdad4",
          paddingBottom: "8px",
          marginBottom: "20px",
        }}
      >
        <button
          onClick={() => setActiveTab("applications")}
          style={{
            background: activeTab === "applications" ? "#004792" : "transparent",
            color: activeTab === "applications" ? "#ffffff" : "#475569",
            border: "none",
            borderRadius: "6px",
            padding: "6px 14px",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <Building2 size={15} />
          <span>My Applications ({apps.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("notices")}
          style={{
            background: activeTab === "notices" ? "#004792" : "transparent",
            color: activeTab === "notices" ? "#ffffff" : "#475569",
            border: "none",
            borderRadius: "6px",
            padding: "6px 14px",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <Mail size={15} />
          <span>Notices ({notices.length})</span>
          {notices.length > 0 && (
            <span
              style={{
                background: "#f59e0b",
                color: "#ffffff",
                fontSize: "10px",
                padding: "1px 5px",
                borderRadius: "10px",
              }}
            >
              Action Required
            </span>
          )}
        </button>
      </div>

      {/* Tab Content: Applications */}
      {activeTab === "applications" && (
        <div>
          {apps.length === 0 ? (
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #dcdad4",
                borderRadius: "10px",
                padding: "48px 24px",
                textAlign: "center",
              }}
            >
              <Building2 size={36} color="#94a3b8" style={{ margin: "0 auto 12px" }} />
              <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
                No Applications Started
              </h2>
              <p style={{ fontSize: "13px", color: "#64748b", margin: "6px 0 16px" }}>
                Click &quot;+ New Application&quot; above to begin your institutional submission.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {apps.map((app) => {
                const appDocs = docs.filter((d) => d.application_id === app.id);
                const appFindings = findings.filter(
                  (f) => f.application_id === app.id && (f.status === "open" || f.status === "under_review")
                );

                // Compute app score
                const reqs = config?.checklists?.[app.application_type]?.required_documents ?? [
                  "application_form",
                  "fire_noc",
                  "lease",
                  "accreditation_letter",
                  "structural_certificate",
                ];
                const passed = reqs.filter((requiredType: string) => {
                  const latest = appDocs
                    .filter((doc) => doc.document_type === requiredType)
                    .sort((left, right) => right.uploaded_at.localeCompare(left.uploaded_at))[0];
                  return latest?.metadata?.precheck
                    ? (latest.metadata.precheck as PreCheckResult).blocker === false
                    : false;
                }).length;
                const score = reqs.length ? Math.round((passed / reqs.length) * 100) : 0;

                return (
                  <article
                    key={app.id}
                    style={{
                      background: "#ffffff",
                      border: "1px solid #dcdad4",
                      borderRadius: "10px",
                      padding: "18px 20px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: "16px",
                      transition: "border-color 0.2s ease",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: "260px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                        <span style={{ fontSize: "12px", fontFamily: "monospace", fontWeight: 700, color: "#004792" }}>
                          {app.application_number}
                        </span>
                        <span style={{ fontSize: "12px", color: "#64748b" }}>·</span>
                        <span style={{ fontSize: "12px", color: "#64748b" }}>{app.academic_year}</span>
                        <span
                          style={{
                            background:
                              app.status === "submitted"
                                ? "#ecfdf5"
                                : app.status === "under_review"
                                ? "#eff6ff"
                                : "#fef3c7",
                            color:
                              app.status === "submitted"
                                ? "#065f46"
                                : app.status === "under_review"
                                ? "#1e40af"
                                : "#92400e",
                            fontSize: "11px",
                            fontWeight: 600,
                            padding: "2px 8px",
                            borderRadius: "12px",
                            textTransform: "capitalize",
                          }}
                        >
                          {app.status.replaceAll("_", " ")}
                        </span>
                      </div>

                      <h2 style={{ fontSize: "15px", fontWeight: 700, color: "#1e293b", margin: "0 0 4px" }}>
                        {(app as unknown as { institutions?: { name?: string } }).institutions?.name || "Institution"}
                      </h2>
                      <div style={{ display: "flex", gap: "12px", fontSize: "12px", color: "#64748b" }}>
                        <span>Type: {app.application_type.replaceAll("_", " ")}</span>
                        <span>·</span>
                        <span>{appDocs.length} Documents</span>
                        <span>·</span>
                        <span>{appFindings.length} Open Indicators</span>
                      </div>
                    </div>

                    {/* Readiness progress ring and Open Action */}
                    <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "11px", fontWeight: 600, color: "#64748b" }}>READINESS</div>
                        <div
                          style={{
                            fontSize: "18px",
                            fontWeight: 800,
                            color: score >= 90 ? "#059669" : score >= 60 ? "#d97706" : "#dc2626",
                          }}
                        >
                          {score}%
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          setCurrentAppId(app.id);
                          setIsCreatingNew(false);
                        }}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          background: "#004792",
                          color: "#ffffff",
                          border: "none",
                          borderRadius: "6px",
                          padding: "8px 14px",
                          fontSize: "12px",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        <span>Open Workspace</span>
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab Content: Notices Tab */}
      {activeTab === "notices" && (
        <div>
          <div style={{ marginBottom: "16px" }}>
            <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
              Officer Deficiency Notices
            </h2>
            <p style={{ fontSize: "12px", color: "#64748b", margin: "2px 0 0" }}>
              Official communications from the scrutiny officer requiring institutional clarification or document re-upload.
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {noticesLoading && <p>Loading notices…</p>}
            {!noticesLoading && noticesError && <p className="review-error" role="alert">{noticesError}</p>}
            {!noticesLoading && !noticesError && notices.length === 0 && <p className="review-empty">No notices yet.</p>}
            {notices.map((notice) => (
              <div
                key={notice.id}
                style={{
                  background: "#ffffff",
                  border: "1px solid #dcdad4",
                  borderRadius: "10px",
                  padding: "18px 20px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "#92400e", background: "#fef3c7", padding: "2px 8px", borderRadius: "10px" }}>
                      {notice.status === "approved" ? "Action Required" : "Draft"}
                    </span>
                    <span style={{ fontSize: "12px", color: "#64748b" }}>
                      Issued: {new Date(notice.created_at).toLocaleDateString()}
                    </span>
                    <span style={{ fontSize: "12px", color: "#64748b" }}>·</span>
                    <span style={{ fontSize: "12px", color: "#64748b" }}>Language: {notice.language.toUpperCase()}</span>
                  </div>

                  <button
                    onClick={() => {
                      setSelectedNotice(notice);
                      setRecheckDiff(null);
                    }}
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
                    <span>Respond & Re-upload</span>
                    <ChevronRight size={13} />
                  </button>
                </div>

                <div
                  style={{
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: "6px",
                    padding: "12px 14px",
                    fontSize: "13px",
                    color: "#334155",
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.5,
                  }}
                >
                  {notice.content}
                </div>
              </div>
            ))}
          </div>

          {/* Respond and Re-upload Modal Drawer */}
          {selectedNotice && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.4)",
                zIndex: 9999,
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <div
                style={{
                  width: "100%",
                  maxWidth: "540px",
                  background: "#ffffff",
                  height: "100%",
                  boxShadow: "-4px 0 20px rgba(0,0,0,0.15)",
                  display: "flex",
                  flexDirection: "column",
                  padding: "24px",
                  overflowY: "auto",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                  <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
                    Respond to Deficiency Notice
                  </h2>
                  <button
                    onClick={() => {
                      setSelectedNotice(null);
                      setRecheckDiff(null);
                      setRecheckError("");
                    }}
                    style={{ background: "none", border: "none", fontSize: "18px", cursor: "pointer", color: "#64748b" }}
                  >
                    ✕
                  </button>
                </div>

                <p style={{ fontSize: "12px", color: "#64748b", margin: "0 0 16px", lineHeight: 1.4 }}>
                  Provide an explanation and re-upload the corrected document. The system will re-run checks immediately.
                </p>

                {/* Explanation textarea */}
                <div style={{ marginBottom: "16px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#334155", display: "block", marginBottom: "6px" }}>
                    Institution Explanation / Remarks
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Describe the action taken (e.g. Enclosed renewed municipal fire NOC valid through 2027)..."
                    value={responseRemarks}
                    onChange={(e) => setResponseRemarks(e.target.value)}
                    style={{
                      width: "100%",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      padding: "8px 12px",
                      fontSize: "12px",
                      fontFamily: "inherit",
                    }}
                  />
                </div>

                {/* Re-upload file input */}
                <div style={{ marginBottom: "20px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#334155", display: "block", marginBottom: "6px" }}>
                    Re-upload Corrected Document
                  </label>
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleNoticeResponse("fire_noc", file);
                    }}
                    style={{ fontSize: "12px" }}
                  />
                </div>

                {/* Live Re-check Result Banner (Resolved / Still open / New) */}
                {recheckBusy && (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "12px", fontSize: "13px", color: "#004792" }}>
                    <Loader2 size={16} className="spin" />
                    <span>Re-running affected statutory checks…</span>
                  </div>
                )}

                {recheckError && <p className="review-error" role="alert">{recheckError}</p>}

                {recheckDiff && (
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: "8px", padding: "14px", background: "#f8fafc", marginBottom: "16px" }}>
                    <h3 style={{ fontSize: "13px", fontWeight: 700, color: "#1e293b", margin: "0 0 8px" }}>
                      Re-Check Results
                    </h3>

                    {/* Resolved */}
                    <div style={{ marginBottom: "8px" }}>
                      <span style={{ fontSize: "11px", fontWeight: 700, color: "#166534", background: "#dcfce7", padding: "2px 6px", borderRadius: "8px" }}>
                        Resolved ({recheckDiff.resolved.length})
                      </span>
                      {recheckDiff.resolved.length > 0 ? (
                        <ul style={{ margin: "4px 0 0", paddingLeft: "18px", fontSize: "12px", color: "#15803d" }}>
                          {recheckDiff.resolved.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      ) : (
                        <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#64748b" }}>None</p>
                      )}
                    </div>

                    {/* Still open */}
                    <div style={{ marginBottom: "8px" }}>
                      <span style={{ fontSize: "11px", fontWeight: 700, color: "#92400e", background: "#fef3c7", padding: "2px 6px", borderRadius: "8px" }}>
                        Still Open ({recheckDiff.still_open.length})
                      </span>
                      {recheckDiff.still_open.length > 0 ? (
                        <ul style={{ margin: "4px 0 0", paddingLeft: "18px", fontSize: "12px", color: "#b45309" }}>
                          {recheckDiff.still_open.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ul>
                      ) : (
                        <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#64748b" }}>None</p>
                      )}
                    </div>

                    {/* New issues */}
                    <div>
                      <span style={{ fontSize: "11px", fontWeight: 700, color: "#4338ca", background: "#e0e7ff", padding: "2px 6px", borderRadius: "8px" }}>
                        New ({recheckDiff.new_issues.length})
                      </span>
                      {recheckDiff.new_issues.length > 0 ? (
                        <ul style={{ margin: "4px 0 0", paddingLeft: "18px", fontSize: "12px", color: "#4338ca" }}>
                          {recheckDiff.new_issues.map((n, i) => (
                            <li key={i}>{n}</li>
                          ))}
                        </ul>
                      ) : (
                        <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#64748b" }}>None</p>
                      )}
                    </div>
                  </div>
                )}

                <div style={{ marginTop: "auto", display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => {
                      setSelectedNotice(null);
                      setRecheckDiff(null);
                    }}
                    style={{
                      background: "transparent",
                      border: "1px solid #cbd5e1",
                      borderRadius: "6px",
                      padding: "8px 14px",
                      fontSize: "12px",
                      cursor: "pointer",
                    }}
                  >
                    Close
                  </button>
                  <button
                    onClick={() => {
                      setSelectedNotice(null);
                      setRecheckDiff(null);
                    }}
                    style={{
                      background: "#004792",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "6px",
                      padding: "8px 14px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
