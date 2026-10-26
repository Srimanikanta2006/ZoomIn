"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { AlertCircle, Check, ChevronRight, FileText, LoaderCircle, Search, X, RotateCcw } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { normalizeRole, type Role } from "@/lib/roles";
import type { Finding } from "@/lib/models";
import { OfficerShell, type OfficerPage } from "@/components/officer-shell";
import { ApplicantWorkspace } from "@/components/applicant-workspace";
import { OfficerQueue } from "@/components/officer-queue";
import { CaseFileWorkspace } from "@/components/case-file-workspace";
import { NoticesWorkspace } from "@/components/notices-workspace";
import { RuleStudioWorkspace } from "@/components/rule-studio-workspace";
import { MetricsWorkspace } from "@/components/metrics-workspace";
import { AuditWorkspace } from "@/components/audit-workspace";

export type Screen = "institution_portal" | "officer_lanes" | "case_file" | "validity_timeline" | "rule_studio" | "audit_page" | "deficiency_letters" | "metrics_page";
export type ApplicationRow = { id: string; institution_id: string; application_number: string; application_type: string; academic_year: string; status: string; created_at: string; updated_at: string; assigned_officer?: string | null; institutions?: { name: string; institution_code?: string; state?: string } | null };
export type DocumentRow = { id: string; application_id: string; document_type: string; file_name: string; storage_path: string; sha256: string; page_count: number | null; uploaded_at: string; metadata: Record<string, unknown> };
export type FieldRow = { id: string; application_id: string; document_id: string; field_key: string; field_value: unknown; page: number | null; bbox: unknown; confidence: number | null; extractor: string };
export type ClaimRow = { id: string; application_id: string; document_id: string | null; field_key: string; claim_value: unknown; status: string | null; evidence_fields: Array<Record<string, unknown>>; finding_id: string | null };
export type VerificationRow = { id: string; document_id: string | null; verification_type: string; source: string; status: string; checked_at: string; result: Record<string, unknown>; requires_manual_review: boolean };
export type AuditRow = { id: number; actor_id: string | null; action: string; entity_type: string; entity_id: string | null; occurred_at: string; details: Record<string, unknown>; prev_hash: string | null; hash: string };
export type LetterRow = { id: string; application_id: string; language: "en" | "hi"; content: string; finding_ids: string[]; status: "draft" | "approved"; created_at: string; updated_at: string; approved_at: string | null; approval_remarks: string };
export type RuleProposal = { id: string; source_sha256: string; source_redacted: string; redaction_summary: Record<string, number>; proposed_rule_yaml: string; status: "proposed" | "approved" | "rejected"; created_at: string; approved_at: string | null; cached?: boolean };
export type EvalDefectMetric = { input_mode: string; defect_type: string; rule_id: string; field: string | null; positive_count: number; tp: number; fp: number; fn: number; tn: number; precision: number | null; recall: number | null; false_positive_rate: number | null };
export type EvalScenario = { input_mode: string; finding_count: number; defect_metrics: EvalDefectMetric[]; decoy_false_positive_rate: { decoy_count: number; flagged_count: number; false_positive_rate: number | null; flagged_applications: string[] }; what_we_miss: Array<{ input_mode: string; application_number: string; defect_type: string; rule_id: string; field: string | null; why: string }> };
export type EvalReport = { status: "empty" } | { generated_at: string; dataset: { name: string; records: number; modes: string[]; synthetic_only: boolean }; pipeline: { llm_mode: string; cache_hits: number; cache_misses: number }; documents_processed: number; average_processing_seconds: number; field_extraction_accuracy: Array<{ input_mode: string; field: string; target: string; correct: number; total: number; accuracy: number | null }>; validation: EvalScenario[]; what_we_miss: Array<{ input_mode: string; application_number: string; defect_type: string; rule_id: string; field: string | null; why: string }>; red_team: Array<{ attempt_id: string; attack: string; attacker_goal: string; target_defect: string; target_rule_id: string; result: string; indicator_emitted: boolean; applications: string[]; pipeline_error?: string | null }>; pipeline_errors: Array<{ relative_path: string; error: string }> };
export type WorkspaceData = { applications: ApplicationRow[]; documents: DocumentRow[]; findings: Finding[]; fields: FieldRow[]; claims: ClaimRow[]; verifications: VerificationRow[] };
export type RuleData = { version: number; reference_date: string; rules: Array<Record<string, unknown>>; checklists: Record<string, { required_documents?: string[] }>; officer_lanes: Record<string, { severities?: string[]; statuses?: string[] }>; officer_timelines?: { review_deadline_days?: number; approaching_deadline_days?: number; ageing_warning_days?: number }; display_options: Record<string, { near_expiry_days?: number }> };

const blankData: WorkspaceData = { applications: [], documents: [], findings: [], fields: [], claims: [], verifications: [] };
const titleByScreen: Record<Screen, string> = { institution_portal: "Institution portal", officer_lanes: "Officer lanes", case_file: "Case file", validity_timeline: "Validity timeline", rule_studio: "Rule studio", audit_page: "Audit log", deficiency_letters: "Deficiency letters", metrics_page: "Metrics" };

function rowName(application: ApplicationRow) { return application.institutions?.name ?? "Institution record"; }
function errorText(error: { message?: string } | null | undefined) { return error?.message || "The data could not be loaded."; }
function readiness(application: ApplicationRow, documents: DocumentRow[], findings: Finding[], required: string[]) {
  const owned = documents.filter((item) => item.application_id === application.id);
  const present = new Set(owned.map((item) => item.document_type));
  const missing = required.filter((item) => !present.has(item));
  const open = findings.filter((item) => item.application_id === application.id && item.status !== "resolved" && item.status !== "dismissed");
  const score = Math.max(0, Math.round((required.length ? (required.length - missing.length) / required.length : 1) * 100) - Math.min(open.length * 8, 40));
  return { score, missing, open, documents: owned };
}

export function ReviewWorkspace({ screen, applicationId }: { screen: Screen; applicationId?: string }) {
  const supabase = getSupabase();
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceData>(blankData);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [ruleProposals, setRuleProposals] = useState<RuleProposal[]>([]);
  const [metricsReport, setMetricsReport] = useState<EvalReport | null>(null);
  const [rules, setRules] = useState<RuleData | null>(null);
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [selectedDocId, setSelectedDocId] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [reviewAction, setReviewAction] = useState<"accept" | "dismiss" | null>(null);
  const [remarks, setRemarks] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewMessage, setReviewMessage] = useState("");
  const [search, setSearch] = useState("");
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [demoStatus, setDemoStatus] = useState({ issuer_outage: false, llm_degraded: false, llm_message: "" });
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoMessage, setDemoMessage] = useState("");

  useEffect(() => {
    if (!supabase) { setLoading(false); setError("Add Supabase URL and anon key to load live workspace data."); return; }
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    let live = true;
    async function loadRole() {
      if (!user || !supabase) { setRole(null); return; }
      const claim = user.app_metadata?.role;
      const claimedRole = normalizeRole(claim);
      if (claimedRole) { if (live) setRole(claimedRole); return; }
      const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
      if (live) setRole(normalizeRole(data?.role));
    }
    void loadRole();
    return () => { live = false; };
  }, [user, supabase]);

  const refreshDemoStatus = useCallback(async () => {
    if (!user || !supabase) return;
    const session = await supabase.auth.getSession();
    const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:7860").replace(/\/$/, "");
    try {
      const response = await fetch(`${apiUrl}/demo/status`, { headers: { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` } });
      if (response.ok) setDemoStatus(await response.json() as typeof demoStatus);
    } catch { /* the regular API health indicator handles connectivity */ }
  }, [user, supabase]);

  useEffect(() => {
    void refreshDemoStatus();
    const timer = window.setInterval(() => void refreshDemoStatus(), 8000);
    return () => window.clearInterval(timer);
  }, [refreshDemoStatus]);

  const toggleIssuerOutage = async () => {
    if (!supabase) return;
    setDemoBusy(true); setDemoMessage("");
    try {
      const session = await supabase.auth.getSession();
      const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:7860").replace(/\/$/, "");
      const response = await fetch(`${apiUrl}/demo/issuer-outage`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.data.session?.access_token ?? ""}` }, body: JSON.stringify({ enabled: !demoStatus.issuer_outage }) });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || "Demo setting could not be updated.");
      await refreshDemoStatus();
      setDemoMessage(!demoStatus.issuer_outage ? "Issuer outage is simulated." : "Issuer outage simulation ended.");
    } catch (cause) { setDemoMessage(errorText(cause as { message?: string })); }
    finally { setDemoBusy(false); }
  };

  const resetDemo = async () => {
    if (!supabase) return;
    setDemoBusy(true); setDemoMessage("");
    let outageError = "";
    if (demoStatus.issuer_outage) {
      try {
        const session = await supabase.auth.getSession();
        const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:7860").replace(/\/$/, "");
        const response = await fetch(`${apiUrl}/demo/issuer-outage`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.data.session?.access_token ?? ""}` }, body: JSON.stringify({ enabled: false }) });
        if (!response.ok) outageError = "Issuer outage could not be cleared.";
      } catch { outageError = "Issuer outage could not be cleared."; }
    }
    if (outageError) setDemoMessage(outageError);
    else {
      try {
        const session = await supabase.auth.getSession();
        if (session.error || !session.data.session) throw new Error("Sign in to reset demo data.");
        const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:7860").replace(/\/$/, "");
        const response = await fetch(`${apiUrl}/demo/reset`, {
          method: "POST",
          headers: { Authorization: `Bearer ${session.data.session.access_token}` },
        });
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || "Demo data could not be reset.");
        setSelectedFinding(null);
        setReviewAction(null);
        window.location.reload();
      } catch (cause) {
        setDemoMessage(errorText(cause as { message?: string }));
      }
    }
    setDemoBusy(false);
  };

  const reload = useCallback(async () => {
    if (!user || !supabase) { setLoading(false); return; }
    setLoading(true); setError("");
    try {
      if (screen === "metrics_page") {
        const session = await supabase.auth.getSession();
        const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:7860").replace(/\/$/, "");
        const response = await fetch(`${apiUrl}/eval/metrics`, { headers: { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` } });
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || "Evaluation metrics could not be loaded.");
        setMetricsReport(await response.json() as EvalReport);
      } else if (screen === "rule_studio") {
        const session = await supabase.auth.getSession();
        const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:7860").replace(/\/$/, "");
        const response = await fetch(`${apiUrl}/rules`, { headers: { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` } });
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || "Rule configuration could not be loaded.");
        const result = await response.json() as RuleData;
        try {
          const { data: proposalRows } = await supabase.from("handbook_rule_proposals").select("id,source_sha256,source_redacted,redaction_summary,proposed_rule_yaml,status,created_at,approved_at").order("created_at", { ascending: false });
          setRuleProposals((proposalRows ?? []) as RuleProposal[]);
        } catch {
          setRuleProposals([]);
        }
        setRules(result); setSelectedRuleId((current) => current || String(result.rules[0]?.id ?? ""));
      } else if (screen === "audit_page") {
        const { data, error: readError } = await supabase.from("audit_log").select("id,actor_id,action,entity_type,entity_id,occurred_at,details,prev_hash,hash").order("id", { ascending: false }).limit(100);
        if (readError) throw readError;
        setAuditRows((data ?? []) as AuditRow[]);
      } else if (screen === "case_file") {
        const { data: app, error: appError } = await supabase.from("applications").select("id,institution_id,application_number,application_type,academic_year,status,created_at,updated_at,institutions(name,institution_code)").eq("id", applicationId).maybeSingle();
        if (appError) throw appError;
        if (!app) { setWorkspace(blankData); return; }

        // Enforce: applicants can ONLY see their own applications
        if (role === "applicant") {
          const { data: profile } = await supabase.from("profiles").select("institution_id").eq("id", user.id).maybeSingle();
          if (profile?.institution_id && profile.institution_id !== app.institution_id) {
            throw new Error("Access denied: applicants may only review applications submitted by their own institution.");
          }
        }
        const { data: docs, error: docError } = await supabase.from("documents").select("id,application_id,document_type,file_name,storage_path,sha256,page_count,uploaded_at,metadata").eq("application_id", applicationId).order("uploaded_at", { ascending: true });
        if (docError) throw docError;
        const { data: findings, error: findingError } = await supabase.from("findings").select("finding_id,application_id,type,severity,document,evidence,rule_id,reason,confidence,status").eq("application_id", applicationId).order("severity");
        if (findingError) throw findingError;
        const docIds = (docs ?? []).map((doc) => doc.id);
        const [fieldsResult, verificationResult, claimsResult] = docIds.length ? await Promise.all([
          supabase.from("extracted_fields").select("id,application_id,document_id,field_key,field_value,page,bbox,confidence,extractor").in("document_id", docIds),
          supabase.from("verifications").select("id,document_id,verification_type,source,status,checked_at,result,requires_manual_review").in("document_id", docIds).order("checked_at", { ascending: false }),
          supabase.from("claims").select("id,application_id,document_id,field_key,claim_value,status,evidence_fields,finding_id").eq("application_id", applicationId),
        ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
        if (fieldsResult.error) throw fieldsResult.error;
        if (verificationResult.error) throw verificationResult.error;
        if (claimsResult.error) throw claimsResult.error;
        const application = app as unknown as ApplicationRow;
        setWorkspace({ applications: [application], documents: (docs ?? []) as DocumentRow[], findings: (findings ?? []) as Finding[], fields: (fieldsResult.data ?? []) as FieldRow[], claims: (claimsResult.data ?? []) as ClaimRow[], verifications: (verificationResult.data ?? []) as VerificationRow[] });
        setSelectedDocId((current) => current || (docs?.[0]?.id ?? ""));
      } else {
        if (["institution_portal", "officer_lanes", "validity_timeline"].includes(screen)) {
          const session = await supabase.auth.getSession();
          const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:7860").replace(/\/$/, "");
          const response = await fetch(`${apiUrl}/workflow-config?view=${screen}`, { headers: { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` } });
          if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || "Workflow configuration could not be loaded.");
          setRules(await response.json() as RuleData);
        }
        let appQuery = supabase.from("applications").select("id,institution_id,application_number,application_type,academic_year,status,created_at,updated_at,assigned_officer,institutions(name,institution_code,state)").order("updated_at", { ascending: false });
        if (role === "applicant") {
          const { data: profile } = await supabase.from("profiles").select("institution_id").eq("id", user.id).maybeSingle();
          if (profile?.institution_id) {
            appQuery = appQuery.eq("institution_id", profile.institution_id);
          } else {
            appQuery = appQuery.limit(1);
          }
        } else {
          appQuery = appQuery.limit(200);
        }
        const { data: apps, error: appError } = await appQuery;
        if (appError) throw appError;
        const list = (apps ?? []) as unknown as ApplicationRow[];
        const ids = list.map((app) => app.id);
        if (!ids.length) { setWorkspace(blankData); return; }
        const [docsResult, findingsResult, fieldsResult] = await Promise.all([
          supabase.from("documents").select("id,application_id,document_type,file_name,storage_path,sha256,page_count,uploaded_at,metadata").in("application_id", ids),
          supabase.from("findings").select("finding_id,application_id,type,severity,document,evidence,rule_id,reason,confidence,status").in("application_id", ids),
          screen === "validity_timeline" ? supabase.from("extracted_fields").select("id,application_id,document_id,field_key,field_value,page,bbox,confidence,extractor").in("application_id", ids).in("field_key", ["valid_until", "issue_date"]) : Promise.resolve({ data: [], error: null }),
        ]);
        if (docsResult.error) throw docsResult.error;
        if (findingsResult.error) throw findingsResult.error;
        if (fieldsResult.error) throw fieldsResult.error;
        setWorkspace({ applications: list, documents: (docsResult.data ?? []) as DocumentRow[], findings: (findingsResult.data ?? []) as Finding[], fields: (fieldsResult.data ?? []) as FieldRow[], claims: [], verifications: [] });
      }
    } catch (cause) {
      setError(errorText(cause as { message?: string }));
    } finally { setLoading(false); }
  }, [user, supabase, screen, applicationId]);

  useEffect(() => {
    let live = true;
    async function load() {
      if (!user || !supabase) { setLoading(false); return; }
      try {
        if (screen === "case_file" && applicationId) {
          try {
            await supabase.rpc("append_audit_event", {
              p_action: "case.opened",
              p_details: { application_id: applicationId },
            });
          } catch {
            // Degrades gracefully on failure
          }
        }
        await reload();
      } catch (cause) { if (live) { setLoading(false); setError(errorText(cause as { message?: string })); } }
    }
    void load();
    return () => { live = false; };
  }, [user, supabase, screen, applicationId, reload]);

  useEffect(() => {
    let live = true;
    async function loadPreview() {
      setPreviewUrl(""); setPreviewError("");
      if (!supabase || !selectedDocId) return;
      const document = workspace.documents.find((item) => item.id === selectedDocId);
      if (!document) return;
      const bucket = process.env.NEXT_PUBLIC_SUPABASE_DOCUMENT_BUCKET || "application-documents";
      const { data, error: storageError } = await supabase.storage.from(bucket).createSignedUrl(document.storage_path, 300);
      if (live && data?.signedUrl) setPreviewUrl(data.signedUrl);
      else if (live) setPreviewError(storageError?.message || "No stored PDF preview is available for this sample.");
    }
    void loadPreview();
    return () => { live = false; };
  }, [supabase, selectedDocId, workspace.documents]);

  const visibleFindings = useMemo(() => workspace.findings.filter((finding) => finding.status === "open" || finding.status === "under_review"), [workspace.findings]);
  const submitReview = async () => {
    if (!supabase || !applicationId || !selectedFinding || !reviewAction || !remarks.trim()) return;
    setReviewBusy(true); setReviewMessage("");
    const { error: actionError } = await supabase.rpc("record_finding_review", {
      p_application_id: applicationId,
      p_finding_id: selectedFinding.finding_id,
      p_action: reviewAction,
      p_remarks: remarks.trim(),
    });
    setReviewBusy(false);
    if (actionError) { setReviewMessage(actionError.message); return; }
    setReviewAction(null); setRemarks(""); setSelectedFinding(null); setReviewMessage("Review recorded.");
    await reload();
  };

  useEffect(() => {
    if (screen !== "case_file" || !role || !["scrutiny_officer", "regional_officer", "admin"].includes(role)) return;
    const handler = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName))) return;
      const key = event.key.toLowerCase();
      if ((key === "a" || key === "d") && selectedFinding) { event.preventDefault(); setReviewAction(key === "a" ? "accept" : "dismiss"); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [screen, role, selectedFinding]);

  const currentApp = (applicationId ? workspace.applications.find((a) => a.id === applicationId) : null) || workspace.applications[0];
  const selectedDoc = workspace.documents.find((item) => item.id === selectedDocId) ?? null;
  const selectedRule = rules?.rules?.find((rule) => rule.id === selectedRuleId);

  // Keep direct routes scoped the same way as navigation.
  const allowed = !role ? false
    : screen === "institution_portal" ? role === "applicant"
    : screen === "officer_lanes" ? (role === "scrutiny_officer" || role === "regional_officer")
    : screen === "case_file" ? (role === "scrutiny_officer" || role === "regional_officer")
    : screen === "deficiency_letters" ? (role === "scrutiny_officer" || role === "regional_officer")
    : screen === "validity_timeline" ? (role === "scrutiny_officer" || role === "regional_officer")
    : screen === "rule_studio" || screen === "audit_page" || screen === "metrics_page" ? (role === "admin")
    : false;

  if (!user) return <div className="review-auth"><section><span className="review-mono">ZOOMIN · REVIEW WORKSPACE</span><h1>{titleByScreen[screen]}</h1><p>Sign in to view live application data.</p><Link href="/">Return to sign in</Link></section></div>;

  const page: OfficerPage =
    screen === "officer_lanes" ? "queue" :
    screen === "institution_portal" ? "portal" :
    screen === "case_file" ? "case_file" :
    screen === "validity_timeline" ? "timeline" :
    screen === "deficiency_letters" ? "notices" :
    screen === "rule_studio" ? "rules" :
    screen === "metrics_page" ? "metrics" :
    screen === "audit_page" ? "audit" : "case_file";

  return <OfficerShell
    page={page}
    email={user.email ?? ""}
    role={role}
    caseHref={applicationId ? `/case/${applicationId}` : currentApp ? `/case/${currentApp.id}` : "/officer"}
    onResetDemo={resetDemo}
    onToggleIssuerOutage={toggleIssuerOutage}
    issuerOutage={demoStatus.issuer_outage}
    demoBusy={demoBusy}
  >
      {!role && <EmptyState title="Your account has no ZoomIn role assigned." detail="Contact an administrator to request workspace access." />}
      {!allowed && role && <EmptyState title="This workspace is not available for your role." detail="Your account permissions do not grant access to this section." />}
      {allowed && <>
        {demoStatus.llm_degraded && <div className="degraded-banner" role="status"><AlertCircle size={15} /><span><b>Degraded mode</b> · {demoStatus.llm_message || "Hosted extraction failed; local extraction is active. Human verification is required."}</span></div>}
        {demoMessage && <div className="demo-message" role="status">{demoMessage}</div>}
        {error && <div className="review-error"><AlertCircle size={16} />{error}</div>}
        {screen === "institution_portal" && (
          <ApplicantWorkspace
            apps={workspace.applications}
            docs={workspace.documents}
            findings={workspace.findings}
            config={rules}
            loading={loading}
            onRefresh={reload}
          />
        )}
        {screen === "officer_lanes" && (
          <OfficerQueue
            apps={workspace.applications}
            findings={workspace.findings}
            lanes={rules?.officer_lanes}
            currentUserId={user?.id ?? ""}
            timelines={rules?.officer_timelines}
            loading={loading}
          />
        )}
        {screen === "case_file" && (
          <CaseFileWorkspace
            app={currentApp || workspace.applications[0]}
            docs={workspace.documents}
            findings={workspace.findings}
            fields={workspace.fields}
            claims={workspace.claims}
            verifications={workspace.verifications}
            role={role}
            onRefresh={reload}
          />
        )}
        {screen === "validity_timeline" && (
          <ValidityTimeline
            loading={loading}
            docs={workspace.documents}
            apps={workspace.applications}
            fields={workspace.fields}
            nearExpiryDays={rules?.display_options.validity_timeline?.near_expiry_days ?? 180}
          />
        )}
        {screen === "rule_studio" && (
          <RuleStudioWorkspace role={role} />
        )}
        {screen === "audit_page" && (
          <AuditWorkspace role={role} />
        )}
        {screen === "deficiency_letters" && <NoticesWorkspace />}
        {screen === "metrics_page" && (
          <MetricsWorkspace />
        )}
      </>}
    {reviewAction && selectedFinding && <div className="review-modal-backdrop" role="presentation"><section className="review-modal" role="dialog" aria-modal="true" aria-labelledby="review-modal-title"><button className="review-modal-close" onClick={() => setReviewAction(null)} aria-label="Close"><X size={17} /></button><p className="review-mono">HUMAN REVIEW · {reviewAction.toUpperCase()}</p><h2 id="review-modal-title">{reviewAction === "accept" ? "Accept finding" : "Dismiss finding"}</h2><p>{selectedFinding.reason}</p><label htmlFor="review-remarks">Remarks</label><textarea id="review-remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Add a short reason for this action" autoFocus /><div className="review-modal-actions"><button className="review-secondary" onClick={() => setReviewAction(null)}>Cancel</button><button className="review-primary" disabled={!remarks.trim() || reviewBusy} onClick={submitReview}>{reviewBusy ? "Saving…" : "Record review"}</button></div>{reviewMessage && <p className="review-inline-error">{reviewMessage}</p>}</section></div>}
  </OfficerShell>;
}

function PageHeader({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: React.ReactNode }) {
  return <div className="review-page-heading"><div><p className="review-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>;
}

function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return <div className="review-empty"><FileText size={21} /><strong>{title}</strong>{detail && <p>{detail}</p>}</div>;
}

function LoadingRows() { return <div className="review-loading"><LoaderCircle size={18} className="spin" />Loading live data…</div>; }

function Metric({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return <article className="review-metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function InstitutionPortal({ loading, apps, docs, findings, config, search, setSearch }: { loading: boolean; apps: ApplicationRow[]; docs: DocumentRow[]; findings: Finding[]; config: RuleData | null; search: string; setSearch: (value: string) => void }) {
  const filtered = apps.filter((app) => `${rowName(app)} ${app.application_number}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <PageHeader eyebrow="INSTITUTION PORTAL / LIVE APPLICATIONS" title="Application readiness" subtitle="Track required documents and review indicators for your applications." action={<Link className="review-secondary" href="/portal">Refresh view <ChevronRight size={14} /></Link>} />
    {loading ? <LoadingRows /> : !apps.length ? <EmptyState title="No applications yet." detail="Applications assigned to your institution will appear here." /> : <>
      <div className="review-metrics"><Metric label="APPLICATIONS" value={apps.length} detail="Visible to your account" /><Metric label="DOCUMENTS" value={docs.length} detail="Uploaded records" /><Metric label="OPEN INDICATORS" value={findings.filter((f) => f.status === "open" || f.status === "under_review").length} detail="Human review required" /></div>
      <label className="review-search"><Search size={15} /><input placeholder="Search applications" value={search} onChange={(event) => setSearch(event.target.value)} suppressHydrationWarning /></label>
      <div className="review-card-list">{filtered.map((app) => {
        const checklist = config?.checklists[app.application_type] ?? config?.checklists.new_institution ?? { required_documents: [] };
        const summary = readiness(app, docs, findings, checklist.required_documents ?? []);
        return <article className="readiness-card" key={app.id}><div className="readiness-main"><div><p className="review-mono">{app.application_number} · {app.academic_year}</p><h2>{rowName(app)}</h2><p>{app.application_type.replaceAll("_", " ")} · {app.status.replaceAll("_", " ")}</p></div><div className="readiness-ring" style={{ "--readiness": `${summary.score}%` } as React.CSSProperties}><strong>{summary.score}%</strong><small>Ready</small></div></div><div className="readiness-progress"><span style={{ width: `${summary.score}%` }} /></div><div className="readiness-foot"><span>{summary.documents.length} documents · {summary.open.length} open indicators</span><Link href={`/case/${app.id}`}>Review application <ChevronRight size={14} /></Link></div>{summary.missing.length > 0 && <p className="readiness-missing">Still needed: {summary.missing.map((item) => item.replaceAll("_", " ")).join(", ")}</p>}</article>;
      })}</div>
    </>}
  </>;
}

function OfficerLanes({ loading, apps, findings, lanes }: { loading: boolean; apps: ApplicationRow[]; findings: Finding[]; lanes?: RuleData["officer_lanes"] }) {
  const order: Array<[string, string]> = [["clean", "No open findings"], ["clarification", "Review"], ["investigation", "Priority review"]];
  const classify = (app: ApplicationRow) => {
    const active = findings.filter((finding) => finding.application_id === app.id && (lanes?.["investigation"]?.statuses ?? ["open", "under_review"]).includes(finding.status));
    for (const [key] of order.slice().reverse()) {
      const rule = lanes?.[key];
      if (active.some((finding) => rule?.severities?.includes(finding.severity))) return key;
    }
    return active.length ? "clarification" : "clean";
  };
  return <>
    <PageHeader eyebrow="OFFICER QUEUE" title="Queue" subtitle="Review submitted applications." />
    {loading ? <LoadingRows /> : !apps.length ? <EmptyState title="No applications in the queue." /> : <div className="lane-grid">{order.map(([key, label]) => {
      const group = apps.filter((app) => classify(app) === key);
      return <section className={`lane lane-${key}`} key={key}><header><div><span className="lane-dot" /><h2>{label}</h2></div></header>{group.length ? group.map((app) => {
        const appFindings = findings.filter((item) => item.application_id === app.id && (item.status === "open" || item.status === "under_review"));
         const topIssue = appFindings.slice().sort((a, b) => ["critical", "high", "medium", "low", "info"].indexOf(a.severity) - ["critical", "high", "medium", "low", "info"].indexOf(b.severity))[0];
         const submitted = new Date(app.created_at || app.updated_at).getTime();
         const daysPending = Number.isFinite(submitted) ? Math.max(0, Math.floor((Date.now() - submitted) / 86_400_000)) : 0;
         return <article className="lane-card" key={app.id}><h3>{rowName(app)}</h3><p>{app.application_type.replaceAll("_", " ")}</p><div className="queue-card-meta"><span>{daysPending} days pending</span><span>{appFindings.length} findings</span></div><p className="queue-top-issue">{topIssue?.reason ?? "No open findings"}</p><Link href={`/case/${app.id}`}>Open case <ChevronRight size={14} /></Link></article>;
      }) : <EmptyState title="No applications in this lane." />}</section>;
    })}</div>}
  </>;
}

function CaseFile({ loading, app, docs, findings, fields, claims, verifications, selectedDoc, selectedDocId, setSelectedDocId, previewUrl, previewError, selectedFinding, setSelectedFinding, setReviewAction, canReview, reviewMessage, role }: { loading: boolean; app?: ApplicationRow; docs: DocumentRow[]; findings: Finding[]; fields: FieldRow[]; claims: ClaimRow[]; verifications: VerificationRow[]; selectedDoc: DocumentRow | null; selectedDocId: string; setSelectedDocId: (id: string) => void; previewUrl: string; previewError: string; selectedFinding: Finding | null; setSelectedFinding: (finding: Finding | null) => void; setReviewAction: (action: "accept" | "dismiss") => void; canReview: boolean; reviewMessage: string; role: Role | null }) {
  const [activeTab, setActiveTab] = useState<"evidence" | "timeline" | "letters">("evidence");
  const selectedFields = fields.filter((field) => field.document_id === selectedDocId);
  const currentBoxes = fields.filter((field) => field.document_id === selectedDocId && field.bbox);
  if (loading) return <><PageHeader eyebrow="CASE FILE / LIVE EVIDENCE" title="Case file" subtitle="Loading application records…" /><LoadingRows /></>;
  if (!app) return <><PageHeader eyebrow="CASE FILE" title="Application not found" subtitle="This application may be unavailable to your account." /><EmptyState title="No case data was returned." /></>;
  return <>
    <PageHeader eyebrow="CASE FILE / DOCUMENT REVIEW" title={rowName(app)} subtitle={`${app.application_number} · ${app.academic_year} · ${app.application_type.replaceAll("_", " ")}`} action={<span className="review-status-pill">{app.status.replaceAll("_", " ")}</span>} />
    
    {/* Embedded Case Sub-tabs for Timeline and Letters */}
    <div style={{ display: "flex", gap: "8px", margin: "14px 0 18px", borderBottom: "1px solid #dcdad4", paddingBottom: "8px" }}>
      <button
        onClick={() => setActiveTab("evidence")}
        style={{
          background: activeTab === "evidence" ? "#032448" : "transparent",
          color: activeTab === "evidence" ? "#ffffff" : "#455468",
          border: "none",
          borderRadius: "6px",
          padding: "6px 14px",
          fontSize: "12px",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Document Evidence & Claims
      </button>
      <button
        onClick={() => setActiveTab("timeline")}
        style={{
          background: activeTab === "timeline" ? "#032448" : "transparent",
          color: activeTab === "timeline" ? "#ffffff" : "#455468",
          border: "none",
          borderRadius: "6px",
          padding: "6px 14px",
          fontSize: "12px",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Validity Timeline ({docs.length})
      </button>
      <button
        onClick={() => setActiveTab("letters")}
        style={{
          background: activeTab === "letters" ? "#032448" : "transparent",
          color: activeTab === "letters" ? "#ffffff" : "#455468",
          border: "none",
          borderRadius: "6px",
          padding: "6px 14px",
          fontSize: "12px",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Deficiency Notices
      </button>
    </div>

    {activeTab === "timeline" && (
      <ValidityTimeline loading={false} docs={docs} apps={[app]} fields={fields} nearExpiryDays={180} />
    )}

    {activeTab === "letters" && (
      <DeficiencyLetters loading={false} apps={[app]} findings={findings} role={role} />
    )}

    {activeTab === "evidence" && (
      <>
        <div className="case-grid">
          <aside className="case-doc-list"><div className="case-section-head"><span>SUBMITTED DOCUMENTS</span><b>{docs.length}</b></div>{docs.length ? docs.map((doc) => <button key={doc.id} className={doc.id === selectedDocId ? "case-doc selected" : "case-doc"} onClick={() => setSelectedDocId(doc.id)}><FileText size={16} /><span><strong>{doc.file_name}</strong><small>{doc.document_type.replaceAll("_", " ")} · {doc.page_count ?? "?"} pages</small></span></button>) : <EmptyState title="No documents uploaded." />}</aside>
          <section className="case-document"><div className="case-section-head"><span>{selectedDoc?.file_name ?? "DOCUMENT PREVIEW"}</span><span className="review-mono">{currentBoxes.length} evidence boxes</span></div>{selectedDoc && previewUrl ? <div className="pdf-preview"><iframe title={`Preview of ${selectedDoc.file_name}`} src={`${previewUrl}#toolbar=0`} /><div className="pdf-overlay" aria-label="Extracted evidence locations">{currentBoxes.map((field) => <EvidenceBox key={field.id} field={field} selected={selectedFinding?.evidence.extracted === String(field.field_value)} />)}</div></div> : <EmptyState title={previewError || "Select a document to preview."} detail="The document viewer uses a short-lived signed link from private storage." />}<div className="evidence-strip"><span><span className="evidence-box-key" />Extracted field location</span><span>Boxes use stored page coordinates.</span></div>{selectedDoc && <div className="field-table"><div className="case-section-head"><span>EXTRACTED FIELDS</span><span>PAGE · CONFIDENCE</span></div>{selectedFields.length ? selectedFields.map((field) => <div className="field-row" key={field.id}><strong>{field.field_key.replaceAll("_", " ")}</strong><span>{String(field.field_value)}</span><small>{field.page ?? "—"} · {field.confidence ? `${Math.round(field.confidence * 100)}%` : "—"}</small></div>) : <EmptyState title="No extracted fields are available." />}</div>}</section>
          <aside className="case-review-panel"><section><div className="case-section-head"><span>CLAIM LEDGER</span><b>{claims.length} claims</b></div>{claims.length ? claims.map((claim) => <article className="claim-row" key={claim.id}><div><strong>{claim.field_key.replaceAll("_", " ")}</strong><span className={`claim-status claim-${(claim.status ?? "unsupported").toLowerCase()}`}>{claim.status ?? "Unscored"}</span></div><p>{String(claim.claim_value)}</p><small>{claim.evidence_fields.length ? `${claim.evidence_fields.length} linked evidence field(s)` : "No evidence linked"}</small></article>) : <EmptyState title="No claims recorded." detail="Declared claims are loaded when available." />}</section><section><div className="case-section-head"><span>FINDINGS</span><b>{findings.length} open</b></div>{findings.length ? findings.map((finding) => <button className={selectedFinding?.finding_id === finding.finding_id ? "finding-card selected" : "finding-card"} key={finding.finding_id} onClick={() => { setSelectedFinding(finding); const docId = (finding.document as unknown as { document_id?: string }).document_id; if (docId) setSelectedDocId(docId); }}><div><span className={`severity-chip sev-${finding.severity}`}>{finding.severity}</span><span className="review-mono">{finding.rule_id}</span></div><p>{finding.reason}</p><small>{finding.evidence.extracted}</small></button>) : <EmptyState title="No open findings." detail="The case has no findings awaiting review." />}</section>
            <section className="verification-panel"><div className="case-section-head"><span>SOURCE VERIFICATION</span><b>{verifications.length}</b></div>{verifications.length ? verifications.map((check) => <article key={check.id}><span className={`verify-status v-${check.status}`}>{check.status.replaceAll("_", " ")}</span><strong>{check.source || check.verification_type}</strong><small>{new Date(check.checked_at).toLocaleString()} · {String(check.result.reason ?? "Check recorded.")}</small>{check.requires_manual_review && <em>Manual review</em>}</article>) : <EmptyState title="No source checks recorded." detail="Unavailable sources must be reviewed manually." />}</section>
            {canReview && <section className="shortcut-note"><strong>Keyboard shortcuts</strong><span><kbd>A</kbd> Accept selected finding <kbd>D</kbd> Dismiss</span><small>Shortcuts open a confirmation and remarks form.</small></section>}{reviewMessage && <p className="review-success">{reviewMessage}</p>}
          </aside>
        </div>
        {selectedFinding && canReview && <div className="case-action-bar"><span>Selected: {selectedFinding.type.replaceAll("_", " ")}</span><div><button className="review-secondary" onClick={() => setReviewAction("dismiss")}><X size={14} /> Dismiss <kbd>D</kbd></button><button className="review-primary" onClick={() => setReviewAction("accept")}><Check size={14} /> Accept finding <kbd>A</kbd></button></div></div>}
      </>
    )}
  </>;
}

function EvidenceBox({ field, selected }: { field: FieldRow; selected: boolean }) {
  const bbox = Array.isArray(field.bbox) ? field.bbox.map(Number) : typeof field.bbox === "object" && field.bbox !== null ? Object.values(field.bbox).map(Number) : [];
  if (bbox.length < 4 || bbox.some((value) => !Number.isFinite(value))) return null;
  const normalized = Math.max(...bbox) <= 1;
  const x = normalized ? bbox[0] * 100 : bbox[0] / 595 * 100;
  const y = normalized ? bbox[1] * 100 : bbox[1] / 842 * 100;
  const width = normalized ? (bbox[2] - bbox[0]) * 100 : (bbox[2] - bbox[0]) / 595 * 100;
  const height = normalized ? (bbox[3] - bbox[1]) * 100 : (bbox[3] - bbox[1]) / 842 * 100;
  return <span className={selected ? "pdf-evidence-box selected" : "pdf-evidence-box"} style={{ left: `${x}%`, top: `${y}%`, width: `${width}%`, height: `${height}%` }} title={field.field_key} />;
}

function ValidityTimeline({ loading, docs, apps, fields, nearExpiryDays }: { loading: boolean; docs: DocumentRow[]; apps: ApplicationRow[]; fields: FieldRow[]; nearExpiryDays: number }) {
  const today = new Date();
  const rows = docs.map((doc) => {
    const field = fields.find((item) => item.document_id === doc.id && item.field_key === "valid_until");
    const value = field?.field_value ? String(field.field_value) : "";
    const date = value ? new Date(value) : null;
    const days = date && Number.isFinite(date.getTime()) ? Math.ceil((date.getTime() - today.getTime()) / 86400000) : null;
    const state = days === null ? "unknown" : days < 0 ? "expired" : days <= nearExpiryDays ? "expiring" : "valid";
    return { doc, field, days, state, app: apps.find((item) => item.id === doc.application_id) };
  }).sort((a, b) => (a.days ?? Number.MAX_SAFE_INTEGER) - (b.days ?? Number.MAX_SAFE_INTEGER));
  return <><PageHeader eyebrow="DOCUMENT VALIDITY / LIVE FIELDS" title="Validity timeline" subtitle={`Review extracted expiry dates. Near-expiry window: ${nearExpiryDays} days.`} />{loading ? <LoadingRows /> : !rows.length ? <EmptyState title="No documents to plot." detail="Validity dates appear after documents and extracted fields are added." /> : <section className="timeline-panel"><div className="timeline-legend"><span><i className="timeline-valid" />Valid</span><span><i className="timeline-expiring" />Near expiry</span><span><i className="timeline-expired" />Expired</span><span><i className="timeline-unknown" />No date</span></div>{rows.map(({ doc, field, days, state, app }) => <article className={`timeline-row timeline-${state}`} key={doc.id}><div className="timeline-doc"><strong>{doc.file_name}</strong><small>{app?.application_number ?? "Application"} · {doc.document_type.replaceAll("_", " ")}</small></div><div className="timeline-track"><span className="timeline-bar" style={{ width: `${state === "unknown" ? 6 : Math.min(100, Math.max(8, 100 - Math.abs(days ?? 0) / 4))}%` }} /><small>{field?.field_value ? String(field.field_value) : "No validity date extracted"}</small></div><span className="timeline-state">{state === "unknown" ? "Not assessed" : state === "expired" ? `${Math.abs(days ?? 0)} days past` : state === "expiring" ? `${days} days left` : "In date"}</span></article>)}</section>}</>;
}

function RuleStudio({ loading, rules, selectedRule, selectedRuleId, setSelectedRuleId, search, setSearch, proposals, setProposals, onReload }: { loading: boolean; rules: RuleData | null; selectedRule?: Record<string, unknown>; selectedRuleId: string; setSelectedRuleId: (id: string) => void; search: string; setSearch: (value: string) => void; proposals: RuleProposal[]; setProposals: (rows: RuleProposal[]) => void; onReload: () => Promise<void> }) {
  const [sourceClause, setSourceClause] = useState("");
  const [proposalId, setProposalId] = useState("");
  const [ruleYaml, setRuleYaml] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const selectedProposal = proposals.find((proposal) => proposal.id === proposalId);
  const filtered = (rules?.rules ?? []).filter((rule) => `${rule.id} ${rule.kind} ${rule.reason ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  useEffect(() => { if (selectedProposal) setRuleYaml(selectedProposal.proposed_rule_yaml); }, [selectedProposal]);
  async function propose() {
    const client = getSupabase();
    if (!client || !sourceClause.trim()) return;
    setBusy(true); setMessage("");
    try {
      const session = await client.auth.getSession();
      const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:7860").replace(/\/$/, "");
      const response = await fetch(`${apiUrl}/rules/propose`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.data.session?.access_token ?? ""}` }, body: JSON.stringify({ clause: sourceClause }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "A rule proposal could not be created.");
      const proposal = result as RuleProposal;
      setProposals([proposal, ...proposals.filter((row) => row.id !== proposal.id)]);
      setProposalId(proposal.id); setRuleYaml(proposal.proposed_rule_yaml);
      setMessage(proposal.cached ? "Loaded the cached proposal for this clause." : "Draft proposal created. It is not active.");
    } catch (cause) { setMessage((cause as Error).message); }
    finally { setBusy(false); }
  }
  async function approve() {
    const client = getSupabase();
    if (!client || !selectedProposal) return;
    setBusy(true); setMessage("");
    try {
      const session = await client.auth.getSession();
      const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:7860").replace(/\/$/, "");
      const response = await fetch(`${apiUrl}/rules/proposals/${selectedProposal.id}/approve`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.data.session?.access_token ?? ""}` }, body: JSON.stringify({ rule_yaml: ruleYaml }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "The rule could not be approved.");
      setProposals(proposals.map((row) => row.id === selectedProposal.id ? result as RuleProposal : row));
      await onReload(); setMessage("Approved rule is now active in validation.");
    } catch (cause) { setMessage((cause as Error).message); }
    finally { setBusy(false); }
  }
  return <>
    <PageHeader eyebrow="ADMINISTRATION / YAML POLICY" title="Rule studio" subtitle="Live rules are loaded from YAML. Handbook proposals stay inactive until admin approval." action={<span className="review-status-pill">Version {rules?.version ?? "—"}</span>} />
    {loading ? <LoadingRows /> : !rules ? <EmptyState title="Rule configuration is unavailable." /> : <>
      <div className="rule-studio-grid"><aside className="rule-explorer"><label className="review-search"><Search size={14} /><input placeholder="Search rules" value={search} onChange={(event) => setSearch(event.target.value)} suppressHydrationWarning /></label><p>ACTIVE RULES <b>{filtered.length}</b></p>{filtered.length ? filtered.map((rule) => <button key={String(rule.id)} className={selectedRuleId === rule.id ? "rule-item selected" : "rule-item"} onClick={() => setSelectedRuleId(String(rule.id))}><span className="review-mono">{String(rule.id)}</span><strong>{String(rule.kind).replaceAll("_", " ")}</strong><small>{String(rule.reason ?? "Rule condition loaded from YAML.")}</small></button>) : <EmptyState title="No rules match." />}</aside><section className="rule-detail">{selectedRule ? <><p className="review-eyebrow">YAML RULE DETAIL</p><h2>{String(selectedRule.id)}</h2><div className="rule-attributes">{Object.entries(selectedRule).map(([key, value]) => <article key={key}><span>{key.replaceAll("_", " ")}</span><pre>{JSON.stringify(value, null, 2)}</pre></article>)}</div><div className="rule-note">Approved handbook YAML is evaluated with the base policy. Other edits require an authorized deployment.</div></> : <EmptyState title="Select a rule to inspect." />}</section><aside className="rule-checklists"><p className="review-eyebrow">APPLICATION CHECKLISTS</p>{Object.entries(rules.checklists).map(([key, value]) => <article key={key}><strong>{key.replaceAll("_", " ")}</strong><small>{value.required_documents?.length ?? 0} required documents</small><p>{value.required_documents?.map((doc) => doc.replaceAll("_", " ")).join(" · ") || "No required document types"}</p></article>)}</aside></div>
      <section className="handbook-panel"><PageHeader eyebrow="HANDBOOK TO RULE · SAMPLE REFERENCE" title="Draft a rule from a clause" subtitle="Personal data is redacted before a hosted-model call. A proposal needs admin approval." /><div className="handbook-source"><label>Source clause · sample<textarea value={sourceClause} onChange={(event) => setSourceClause(event.target.value)} placeholder="Paste a sample handbook clause" /></label><div className="handbook-result"><label>Proposed YAML<textarea value={ruleYaml} onChange={(event) => setRuleYaml(event.target.value)} placeholder="The YAML proposal appears here" readOnly={!selectedProposal || selectedProposal.status !== "proposed"} /></label>{selectedProposal && <small>{selectedProposal.status.toUpperCase()} · {selectedProposal.source_sha256.slice(0, 16)}… · redactions {Object.values(selectedProposal.redaction_summary ?? {}).reduce((sum, count) => sum + count, 0)}</small>}</div></div><div className="handbook-controls"><button className="review-secondary" onClick={propose} disabled={busy || !sourceClause.trim()}>{busy ? "Working…" : "Propose YAML"}</button>{selectedProposal?.status === "proposed" && <button className="review-primary" onClick={approve} disabled={busy || !ruleYaml.trim()}>Approve and activate</button>}{message && <span className="review-mono">{message}</span>}</div><div className="handbook-proposals"><b>Saved proposals · sample</b>{proposals.length ? proposals.map((proposal) => <button key={proposal.id} className={proposalId === proposal.id ? "rule-item selected" : "rule-item"} onClick={() => { setProposalId(proposal.id); setSourceClause(proposal.source_redacted); }}><span>{proposal.source_redacted.slice(0, 150)}</span><small>{proposal.status} · {new Date(proposal.created_at).toLocaleString()}</small></button>) : <EmptyState title="No proposals yet." />}</div></section>
    </>}
  </>;
}

function AuditPage({ loading, error, rows, search, setSearch, onReload }: { loading: boolean; error: string; rows: AuditRow[]; search: string; setSearch: (value: string) => void; onReload: () => Promise<void> }) {
  const [checking, setChecking] = useState(false);
  const [integrity, setIntegrity] = useState<{ valid: boolean; checked_count: number; first_invalid_id: number | null; checked_at: string } | null>(null);
  const [checkError, setCheckError] = useState("");
  const filtered = rows.filter((row) => `${row.action} ${row.entity_type} ${row.entity_id ?? ""} ${JSON.stringify(row.details)}`.toLowerCase().includes(search.toLowerCase()));
  async function verify() {
    const client = getSupabase();
    if (!client) return;
    setChecking(true); setCheckError(""); setIntegrity(null);
    try {
      const session = await client.auth.getSession();
      const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:7860").replace(/\/$/, "");
      const response = await fetch(`${apiUrl}/audit/verify`, { method: "POST", headers: { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Integrity check failed.");
      setIntegrity(result as typeof integrity);
      await onReload();
    } catch (cause) { setCheckError((cause as Error).message); }
    finally { setChecking(false); }
  }
  return <><PageHeader eyebrow="SYSTEM AUDIT / HASH CHAIN" title="Audit log" subtitle="Recent workspace, validation, and reviewer events from the append-only ledger." action={<button className="review-primary" disabled={checking || loading} onClick={verify}>{checking ? "Verifying…" : "Verify integrity"}</button>} /><div className="audit-chain-strip"><span><i /> Hash-chained entries</span><span>Showing latest {rows.length} events</span>{rows[0] && <span className="review-mono">Latest hash · {rows[0].hash.slice(0, 16)}…</span>}</div>{integrity && <div className={integrity.valid ? "integrity-result valid" : "integrity-result invalid"}><b>{integrity.valid ? "Chain integrity confirmed" : `Integrity issue at entry ${integrity.first_invalid_id}`}</b><span>{integrity.checked_count} entries checked · {new Date(integrity.checked_at).toLocaleString()}</span><small>The verification event is appended after the checked range.</small></div>}{checkError && <div className="review-error">{checkError}</div>}{loading ? <LoadingRows /> : error ? <EmptyState title="Audit log is unavailable." detail="Check the assigned role and audit migration." /> : !rows.length ? <EmptyState title="No audit events yet." detail="Actions appear after a signed-in workspace is opened." /> : <><label className="review-search"><Search size={15} /><input placeholder="Search action, entity, or details" value={search} onChange={(event) => setSearch(event.target.value)} suppressHydrationWarning /></label><section className="audit-table-wrap"><table className="audit-table"><thead><tr><th>TIME</th><th>ACTION</th><th>ENTITY</th><th>DETAILS</th><th>HASH LINKS</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td>{new Date(row.occurred_at).toLocaleString()}</td><td><span className="audit-action">{row.action}</span></td><td>{row.entity_type}{row.entity_id && <small>{row.entity_id}</small>}</td><td><pre>{JSON.stringify(row.details, null, 2)}</pre></td><td className="review-mono"><small>prev · {row.prev_hash?.slice(0, 12) ?? "root"}</small><small>hash · {row.hash.slice(0, 12)}</small></td></tr>)}</tbody></table>{!filtered.length && <EmptyState title="No events match." />}</section></>}</>;
}

function hindiFindingSummary(finding: Finding) {
  const type = finding.type.toLowerCase();
  if (type.includes("expired")) return "दस्तावेज़ की वैधता अवधि समाप्त हो चुकी है।";
  if (type.includes("missing") || type.includes("required")) return "आवश्यक दस्तावेज़ या जानकारी जमा नहीं की गई है।";
  if (type.includes("contradiction") || type.includes("mismatch")) return "घोषित जानकारी और दस्तावेज़ में दिए गए विवरण में अंतर है।";
  if (type.includes("duplicate")) return "यह दस्तावेज़ किसी अन्य संस्था के आवेदन में भी दर्ज है।";
  if (type.includes("repeated")) return "यह विवरण किसी अन्य आवेदन में भी दर्ज है।";
  return "स्वीकृत निष्कर्ष के अनुसार इस बिंदु की समीक्षा और स्पष्टीकरण आवश्यक है।";
}

function DeficiencyLetters({ loading, apps, findings, role }: { loading: boolean; apps: ApplicationRow[]; findings: Finding[]; role: Role | null }) {
  const supabase = getSupabase();
  const [applicationId, setApplicationId] = useState("");
  const [reviews, setReviews] = useState<Array<{ finding_id: string; action: string; created_at: string }>>([]);
  const [letters, setLetters] = useState<LetterRow[]>([]);
  const [letterId, setLetterId] = useState("");
  const [language, setLanguage] = useState<"en" | "hi">("en");
  const [content, setContent] = useState("");
  const [approvalRemarks, setApprovalRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => { if (!applicationId && apps[0]) setApplicationId(apps[0].id); }, [apps, applicationId]);
  const load = useCallback(async () => {
    if (!supabase || !applicationId) { setReviews([]); setLetters([]); return; }
    const [reviewResult, letterResult] = await Promise.all([
      supabase.from("reviews").select("id,finding_id,action,created_at").eq("application_id", applicationId).order("created_at", { ascending: false }).order("id", { ascending: false }),
      supabase.from("deficiency_letters").select("id,application_id,language,content,finding_ids,status,created_at,updated_at,approved_at,approval_remarks").eq("application_id", applicationId).order("created_at", { ascending: false }),
    ]);
    setReviews(reviewResult?.data ?? []); setLetters((letterResult?.data ?? []) as LetterRow[]);
  }, [supabase, applicationId]);
  useEffect(() => { setError(""); load().catch((cause) => setError(errorText(cause as { message?: string }))); }, [load]);
  useEffect(() => { const item = letters.find((letter) => letter.id === letterId); if (item) { setContent(item.content); setLanguage(item.language); } else if (!letterId) setContent(""); }, [letterId, letters]);
  const app = apps.find((item) => item.id === applicationId);
  const latestAction = new Map<string, string>();
  for (const review of reviews) if (review.finding_id && !latestAction.has(review.finding_id)) latestAction.set(review.finding_id, review.action);
  const accepted = findings.filter((finding) => finding.application_id === applicationId && latestAction.get(finding.finding_id) === "accept");
  const selectedLetter = letters.find((letter) => letter.id === letterId);
  const canReview = role !== null && ["scrutiny_officer", "regional_officer", "admin"].includes(role);
  function makeLetter(lang: "en" | "hi") {
    if (!app || accepted.length === 0) return "";
    const name = rowName(app);
    const items = lang === "en"
      ? accepted.map((finding, index) => `${index + 1}. ${finding.reason} (Rule ${finding.rule_id})`).join("\n")
      : accepted.map((finding, index) => `${index + 1}. ${hindiFindingSummary(finding)} (नियम ${finding.rule_id})`).join("\n");
    if (lang === "en") return `To: ${name}\nApplication: ${app.application_number}\n\nSubject: Deficiency letter\n\nFollowing officer review, the accepted findings below are included for your response:\n\n${items}\n\nPlease provide a response and any supporting records through the application portal. An officer will review your submission before any decision is made.\n\nZoomIn review desk`;
    return `प्रति: ${name}\nआवेदन: ${app.application_number}\n\nविषय: कमी के संबंध में सूचना\n\nअधिकारी की समीक्षा के बाद नीचे दिए गए स्वीकृत बिंदुओं पर आपका उत्तर अपेक्षित है:\n\n${items}\n\nकृपया आवेदन पोर्टल पर अपना उत्तर और सहायक दस्तावेज़ जमा करें। किसी भी निर्णय से पहले अधिकारी आपके उत्तर की समीक्षा करेंगे।\n\nZoomIn समीक्षा कार्यालय`;
  }
  async function createDraft() {
    if (!supabase || accepted.length === 0) return;
    setBusy(true); setError(""); setMessage("");
    const draft = makeLetter(language);
    const { data, error: createError } = await supabase.rpc("create_deficiency_letter", { p_application_id: applicationId, p_language: language, p_content: draft, p_finding_ids: accepted.map((finding) => finding.finding_id) });
    setBusy(false);
    if (createError) { setError(createError.message); return; }
    await load(); setLetterId(String(data)); setContent(draft); setMessage("Draft created from officer-accepted findings.");
  }
  async function saveDraft() {
    if (!supabase || !selectedLetter || selectedLetter.status !== "draft") return;
    setBusy(true); setError("");
    const { error: saveError } = await supabase.rpc("update_deficiency_letter", { p_letter_id: selectedLetter.id, p_content: content });
    setBusy(false);
    if (saveError) { setError(saveError.message); return; }
    await load(); setMessage("Draft saved to the audit log.");
  }
  async function approve() {
    if (!supabase || !selectedLetter || !approvalRemarks.trim()) return;
    setBusy(true); setError("");
    const { error: approvalError } = await supabase.rpc("approve_deficiency_letter", { p_letter_id: selectedLetter.id, p_remarks: approvalRemarks.trim() });
    setBusy(false);
    if (approvalError) { setError(approvalError.message); return; }
    setApprovalRemarks(""); await load(); setMessage("Officer approval recorded.");
  }
  return <>
    <PageHeader eyebrow="OFFICER WORKSPACE / LETTERS" title="Deficiency letters" subtitle="Create an editable draft from accepted findings. An officer must approve it." />
    {loading ? <LoadingRows /> : !apps.length ? <EmptyState title="No applications available." detail="Applications visible to your role will appear here." /> : <>
      <div className="letter-controls"><label>Application<select value={applicationId} onChange={(event) => { setApplicationId(event.target.value); setLetterId(""); }}><option value="">Select an application</option>{apps.map((item) => <option key={item.id} value={item.id}>{item.application_number} · {rowName(item)}</option>)}</select></label><label>Language<select value={language} onChange={(event) => setLanguage(event.target.value as "en" | "hi")}><option value="en">English</option><option value="hi">हिन्दी</option></select></label><button className="review-primary" disabled={busy || !accepted.length || !canReview} onClick={createDraft}>Generate draft from {accepted.length} accepted finding{accepted.length === 1 ? "" : "s"}</button></div>
      <div className="letter-workspace"><aside className="letter-list"><p className="review-eyebrow">SAVED LETTERS</p>{letters.length ? letters.map((letter) => <button key={letter.id} className={letterId === letter.id ? "rule-item selected" : "rule-item"} onClick={() => setLetterId(letter.id)}><strong>{letter.language === "hi" ? "हिन्दी" : "English"} letter</strong><small>{letter.status} · {new Date(letter.updated_at).toLocaleString()}</small></button>) : <EmptyState title="No letters saved." detail="Generate a draft after findings are accepted." />}</aside><section className="letter-editor"><div className="case-section-head"><span>{selectedLetter ? `${selectedLetter.language === "hi" ? "हिन्दी" : "English"} · ${selectedLetter.status.toUpperCase()}` : "LETTER DRAFT"}</span><b>{selectedLetter?.finding_ids.length ?? 0} accepted findings</b></div>{selectedLetter ? <><textarea aria-label="Editable deficiency letter" value={content} onChange={(event) => setContent(event.target.value)} readOnly={selectedLetter.status === "approved"} />{selectedLetter.status === "draft" ? <div className="letter-approval"><button className="review-secondary" disabled={busy} onClick={saveDraft}>Save edits</button><label>Officer approval remarks<textarea value={approvalRemarks} onChange={(event) => setApprovalRemarks(event.target.value)} placeholder="Required for approval" /></label><button className="review-primary" disabled={busy || !approvalRemarks.trim() || !canReview} onClick={approve}>Approve letter</button></div> : <div className="integrity-result valid"><b>Approved by an officer</b><span>{selectedLetter.approval_remarks}</span></div>}</> : <EmptyState title="Select or create a letter." detail="Only findings with a latest officer acceptance can be included." />}</section></div>
    </>}
    {error && <div className="review-error">{error}</div>}{message && <p className="review-success">{message}</p>}
  </>;
}

function MetricsPage({ loading, report, error, onReload }: { loading: boolean; report: EvalReport | null; error: string; onReload: () => Promise<void> }) {
  if (loading) return <><PageHeader eyebrow="SYNTHETIC EVALUATION" title="Metrics" subtitle="Pipeline results from the generated evaluation set." /><LoadingRows /></>;
  if (error) return <><PageHeader eyebrow="SYNTHETIC EVALUATION" title="Metrics" subtitle="Pipeline results from the generated evaluation set." action={<button className="review-secondary" onClick={() => void onReload()}>Retry</button>} /><div className="review-error">{error}</div><EmptyState title="Metrics are unavailable." detail="Run python eval/run.py and check the API report path." /></>;
  if (!report || "status" in report) return <><PageHeader eyebrow="SYNTHETIC EVALUATION" title="Metrics" subtitle="Evaluation results from the generated synthetic set." /><EmptyState title="No data yet." /></>;
  const observed = report.field_extraction_accuracy.filter((item) => item.target === "observed");
  const misses = report.what_we_miss;
  const decoyTotal = report.validation.reduce((sum, scenario) => sum + scenario.decoy_false_positive_rate.decoy_count, 0);
  const decoyFlags = report.validation.reduce((sum, scenario) => sum + scenario.decoy_false_positive_rate.flagged_count, 0);
  const escaped = report.red_team.filter((item) => !item.indicator_emitted).length;
  return <>
    <PageHeader eyebrow="SYNTHETIC EVALUATION / LIVE REPORT" title="Metrics" subtitle={`${report.dataset.records} fictional applications · ${report.documents_processed} original and scanned PDFs`} action={<button className="review-secondary" onClick={() => void onReload()}>Refresh report</button>} />
    <div className="metrics-meta"><span>{report.pipeline.llm_mode === "local" ? "Local extraction" : "Free-tier Gemini extraction"}</span><span>Generated {new Date(report.generated_at).toLocaleString()}</span><span>{report.pipeline.cache_hits} cache hits · {report.pipeline.cache_misses} runs</span></div>
    <div className="review-metrics"><Metric label="DOCUMENTS PROCESSED" value={report.documents_processed} detail={`${report.dataset.modes.join(" + ")} inputs`} /><Metric label="AVERAGE PROCESSING" value={`${report.average_processing_seconds.toFixed(2)}s`} detail="Observed wall time per PDF" /><Metric label="DECOY FLAG RATE" value={decoyTotal ? `${(100 * decoyFlags / decoyTotal).toFixed(1)}%` : "N/A"} detail={`${decoyFlags} / ${decoyTotal} valid decoy cases flagged by defect checks`} /><Metric label="RED-TEAM EVASIONS" value={`${escaped} / ${report.red_team.length}`} detail="Attempts with no target indicator" /></div>
    <section className="metrics-section"><div className="metrics-section-head"><div><p className="review-eyebrow">FIELD EXTRACTION / OBSERVED VALUES</p><h2>Accuracy by field</h2></div><span>Compared with the printed value in ground_truth.csv</span></div><div className="metrics-table-wrap"><table className="metrics-table"><thead><tr><th>INPUT</th><th>FIELD</th><th>CORRECT / TOTAL</th><th>ACCURACY</th></tr></thead><tbody>{observed.map((item) => <tr key={`${item.input_mode}-${item.field}`}><td>{item.input_mode}</td><td>{item.field.replaceAll("_", " ")}</td><td>{item.correct} / {item.total}</td><td>{item.accuracy === null ? "N/A" : `${(item.accuracy * 100).toFixed(1)}%`}</td></tr>)}</tbody></table></div></section>
    <section className="metrics-section"><div className="metrics-section-head"><div><p className="review-eyebrow">RULE EVALUATION</p><h2>Flag precision and recall</h2></div><span>Per planted defect type and input mode</span></div><div className="metrics-table-wrap"><table className="metrics-table"><thead><tr><th>INPUT</th><th>DEFECT TYPE</th><th>PRECISION</th><th>RECALL</th><th>TP</th><th>FP</th><th>FN</th></tr></thead><tbody>{report.validation.flatMap((scenario) => scenario.defect_metrics.map((item) => <tr key={`${item.input_mode}-${item.defect_type}`}><td>{item.input_mode}</td><td>{item.defect_type.replaceAll("_", " ")}</td><td>{item.precision === null ? "N/A" : `${(item.precision * 100).toFixed(1)}%`}</td><td>{item.recall === null ? "N/A" : `${(item.recall * 100).toFixed(1)}%`}</td><td>{item.tp}</td><td>{item.fp}</td><td>{item.fn}</td></tr>))}</tbody></table></div></section>
    <section className="metrics-section misses-section"><div className="metrics-section-head"><div><p className="review-eyebrow">ERROR ANALYSIS</p><h2>What we miss</h2></div><span>{misses.length} missed case{misses.length === 1 ? "" : "s"}</span></div>{misses.length ? <div className="miss-list">{misses.map((item, index) => <article key={`${item.input_mode}-${item.application_number}-${item.defect_type}-${index}`}><span className="metrics-mode">{item.input_mode}</span><strong>{item.defect_type.replaceAll("_", " ")}</strong><span>{item.application_number}</span><small>{item.why}</small></article>)}</div> : <EmptyState title="No target cases were missed." detail="Review red-team outcomes for known evasion limits." />}</section>
    <section className="metrics-section"><div className="metrics-section-head"><div><p className="review-eyebrow">RED TEAM / SYNTHETIC ATTEMPTS</p><h2>Attempts to fool the pipeline</h2></div><span>{report.red_team.length} cases</span></div><div className="metrics-table-wrap"><table className="metrics-table"><thead><tr><th>CASE</th><th>ATTEMPT</th><th>TARGET</th><th>RESULT</th><th>APPLICATIONS</th></tr></thead><tbody>{report.red_team.map((item) => <tr key={item.attempt_id}><td>{item.attempt_id}</td><td>{item.attack}</td><td>{item.target_defect.replaceAll("_", " ")}</td><td><span className={item.indicator_emitted ? "metrics-outcome resisted" : "metrics-outcome missed"}>{item.indicator_emitted ? "Indicator emitted" : "Not detected"}</span></td><td>{item.applications.join(", ")}</td></tr>)}</tbody></table></div></section>
    {report.pipeline_errors.length > 0 && <section className="metrics-section"><div className="metrics-section-head"><div><p className="review-eyebrow">PIPELINE AVAILABILITY</p><h2>Processing errors</h2></div></div>{report.pipeline_errors.map((item) => <p className="review-inline-error" key={item.relative_path}>{item.relative_path}: {item.error}</p>)}</section>}
  </>;
}
