"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  BookOpen,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Play,
  UploadCloud,
  FileCode,
  History,
  ShieldCheck,
  ChevronRight,
  Info,
  Layers,
  Save,
  RotateCcw,
  Sparkles,
  Lock,
} from "lucide-react";
import type { Role } from "@/lib/models";
import { getSupabaseClient } from "@/lib/supabase";

export interface EditableRule {
  id: string;
  kind: string;
  field: string;
  condition: string;
  threshold: string | number;
  severity: "info" | "low" | "medium" | "high" | "critical";
  message: string;
  source_clause: string;
  application_types: string[]; // ["all"] or specific types
}

export interface RuleVersion {
  version: string;
  published_at: string;
  author: string;
  remarks: string;
  rules_count: number;
}

interface SampleTestResult {
  before_count: number;
  after_count: number;
  diff: number;
  sample_applications: Array<{
    application_number: string;
    institution: string;
    before: number;
    after: number;
    diff: number;
  }>;
}

export function RuleStudioWorkspace({ role }: { role?: Role | null }) {
  const isAdmin = role === "admin";

  // Application type filter options (Replacing the search box)
  const [appTypeFilter, setAppTypeFilter] = useState<string>("all");

  // Active view: "form" | "advanced_yaml" | "history"
  const [activeTab, setActiveTab] = useState<"form" | "advanced_yaml" | "history">("form");

  // Initial rule dataset
  const [rules, setRules] = useState<EditableRule[]>([
    {
      id: "CLAIM-FIELD-COMPARISON",
      kind: "field_comparison",
      field: "institution_name",
      condition: "fuzzy_string_match",
      threshold: "0.84",
      severity: "high",
      message:
        "The institution name in the document differs from the application claim. This is an indicator requiring human verification.",
      source_clause:
        "AICTE Approval Process Handbook (APH) 2026-27, Chapter I, Clause 1.4: Statutory Applicant Name and Society Alignment.",
      application_types: ["all"],
    },
    {
      id: "REQUIRED-SIGNATURE",
      kind: "field_expected_value",
      field: "signature_present",
      condition: "field_required_boolean",
      threshold: "true",
      severity: "high",
      message:
        "The application expects a signature, but the document shows a blank signature line. This is an indicator requiring human verification.",
      source_clause:
        "AICTE APH 2026-27, Chapter IV, Clause 4.8: Mandatory Execution and Attestation of Affidavits by Authorized Signatory.",
      application_types: ["new_institution", "extension_of_approval", "increase_in_intake", "new_program"],
    },
    {
      id: "DOCUMENT-VALIDITY-PERIOD",
      kind: "date_arithmetic",
      field: "valid_until",
      condition: "on_or_after_reference_date",
      threshold: "180", // Near-expiry window days
      severity: "high",
      message:
        "The document validity date is before the review reference date. Human verification is required.",
      source_clause:
        "AICTE APH 2026-27, Chapter II, Clause 2.12: Mandatory Validity of Fire NOC and Land Lease at time of application.",
      application_types: ["new_institution", "extension_of_approval", "renewal"],
    },
    {
      id: "DUPLICATE-FILE-CROSS-INSTITUTION",
      kind: "cross_document_equality",
      field: "sha256",
      condition: "minimum_distinct_institutions",
      threshold: "2",
      severity: "high",
      message:
        "The same document file cryptographic hash is present in applications for multiple institutions. This is an indicator requiring human verification.",
      source_clause:
        "AICTE APH 2026-27, Norms for Prevention of Multiple Approvals on Identical Building Layouts and Premises.",
      application_types: ["new_institution", "new_program"],
    },
    {
      id: "SHARED-FACULTY-REFERENCE",
      kind: "cross_document_equality",
      field: "faculty_reference_id",
      condition: "minimum_distinct_institutions",
      threshold: "2",
      severity: "medium",
      message:
        "The same faculty identification record appears in multiple institutional submissions without approved joint-tenure.",
      source_clause:
        "AICTE APH 2026-27, Appendix 7: Faculty Cadre Ratio, Full-Time Declaration, and Prohibition of Simultaneous Primary Postings.",
      application_types: ["new_institution", "increase_in_intake", "new_program"],
    },
    {
      id: "SHARED-INSTITUTION-ADDRESS",
      kind: "cross_document_equality",
      field: "institution_address",
      condition: "fuzzy_address_match",
      threshold: "0.94",
      severity: "medium",
      message:
        "The physical campus parcel address matches an existing approved institution premises declaration.",
      source_clause:
        "AICTE APH 2026-27, Chapter IV, Clause 4.2: Land and Infrastructure Requirements for Technical Education Campuses.",
      application_types: ["new_institution", "new_program"],
    },
    {
      id: "REQUIRED-DOCUMENTS",
      kind: "required_documents",
      field: "document_checklist",
      condition: "all_required_present",
      threshold: "7",
      severity: "high",
      message:
        "A statutory mandatory document type is missing for this application type: {document_type}.",
      source_clause:
        "AICTE APH 2026-27, Chapter I: Mandatory Supporting Document Schedule for Scrutiny and Evaluation.",
      application_types: ["new_institution", "extension_of_approval", "increase_in_intake", "new_program"],
    },
  ]);

  const [selectedRuleId, setSelectedRuleId] = useState<string>("CLAIM-FIELD-COMPARISON");
  const selectedRule = useMemo(
    () => rules.find((r) => r.id === selectedRuleId) || rules[0],
    [rules, selectedRuleId]
  );

  // Form draft state for currently selected rule
  const [formDraft, setFormDraft] = useState<EditableRule>(selectedRule);

  // Sync draft when selected rule changes
  useEffect(() => {
    if (selectedRule) {
      setFormDraft({ ...selectedRule });
    }
  }, [selectedRule]);

  // Version History state
  const [versions, setVersions] = useState<RuleVersion[]>([
    {
      version: "v1.2",
      published_at: "2026-10-26T22:30:00Z",
      author: "Admin (Chief Scrutiny Officer)",
      remarks: "Calibrated faculty sharing threshold and near-expiry observation window.",
      rules_count: 7,
    },
    {
      version: "v1.1",
      published_at: "2026-10-22T14:15:00Z",
      author: "Admin (Policy Directorate)",
      remarks: "Integrated cryptographic file hash duplicate detection across distinct institutions.",
      rules_count: 6,
    },
    {
      version: "v1.0",
      published_at: "2026-10-18T09:00:00Z",
      author: "System (Baseline AICTE APH)",
      remarks: "Initial statutory baseline validation rule set for Academic Year 2026-27.",
      rules_count: 5,
    },
  ]);

  // Testing on Sample Applications state
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<SampleTestResult | null>(null);

  // Publish state
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [publishRemarks, setPublishRemarks] = useState("");
  const [publishBusy, setPublishBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  // Audit logging helper
  const logAudit = async (action: string, details: Record<string, unknown>) => {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        await supabase.rpc("append_audit_event", {
          p_action: action,
          p_details: details,
        });
      } catch (err) {
        console.warn("Audit logging warning:", err);
      }
    }
  };

  // Filter rules by application type
  const filteredRules = useMemo(() => {
    if (appTypeFilter === "all") return rules;
    return rules.filter(
      (r) => r.application_types.includes("all") || r.application_types.includes(appTypeFilter)
    );
  }, [rules, appTypeFilter]);

  // Handle Form Change
  const handleFieldChange = <K extends keyof EditableRule>(key: K, value: EditableRule[K]) => {
    setFormDraft((prev) => ({ ...prev, [key]: value }));
  };

  // Save changes to current rule
  const handleSaveRule = () => {
    setRules((prev) => prev.map((r) => (r.id === formDraft.id ? { ...formDraft } : r)));
    setStatusMessage(`Rule "${formDraft.id}" updated in local draft.`);
    setTimeout(() => setStatusMessage(""), 4000);
  };

  // Handle "Test on sample applications"
  const handleTestOnSample = async () => {
    setIsTesting(true);
    setStatusMessage("");

    // Simulate rule execution against sample institutions
    setTimeout(() => {
      // Before vs after finding counts
      const samples = [
        { application_number: "DEMO-APP-2026-001", institution: "Alpha Institute of Tech", before: 3, after: 3, diff: 0 },
        { application_number: "DEMO-APP-2026-002", institution: "Beta Polytechnic", before: 4, after: 3, diff: -1 },
        { application_number: "DEMO-APP-2026-003", institution: "Gamma Eng. College", before: 2, after: 2, diff: 0 },
        { application_number: "DEMO-APP-2026-004", institution: "Delta Inst. of Mgmt", before: 3, after: 2, diff: -1 },
        { application_number: "DEMO-APP-2026-005", institution: "Epsilon Tech Academy", before: 2, after: 2, diff: 0 },
      ];
      const beforeTotal = samples.reduce((acc, s) => acc + s.before, 0);
      const afterTotal = samples.reduce((acc, s) => acc + s.after, 0);

      const result: SampleTestResult = {
        before_count: beforeTotal,
        after_count: afterTotal,
        diff: afterTotal - beforeTotal,
        sample_applications: samples,
      };

      setTestResult(result);
      setIsTesting(false);

      void logAudit("rule_studio.test_sample_applications", {
        before_count: beforeTotal,
        after_count: afterTotal,
        diff: afterTotal - beforeTotal,
        active_rules_count: rules.length,
      });
    }, 700);
  };

  // Handle Publish (Admin Only, Audited)
  const handlePublish = async () => {
    if (!isAdmin) return;
    if (!publishRemarks.trim()) {
      setStatusMessage("Publication remarks are required to document the change justification.");
      return;
    }

    setPublishBusy(true);

    const nextVerNum = (parseFloat(versions[0]?.version.replace("v", "") || "1.2") + 0.1).toFixed(1);
    const newVersionStr = `v${nextVerNum}`;

    await logAudit("rule_studio.publish_rules", {
      version: newVersionStr,
      remarks: publishRemarks,
      rules_count: rules.length,
      published_at: new Date().toISOString(),
    });

    const newVersionEntry: RuleVersion = {
      version: newVersionStr,
      published_at: new Date().toISOString(),
      author: "Admin (Current Session)",
      remarks: publishRemarks,
      rules_count: rules.length,
    };

    setVersions([newVersionEntry, ...versions]);
    setPublishBusy(false);
    setIsPublishModalOpen(false);
    setPublishRemarks("");
    setStatusMessage(`Rules version ${newVersionStr} successfully published and logged to audit table!`);
    setTimeout(() => setStatusMessage(""), 5000);
  };

  // Generate clean read-only YAML
  const generatedYaml = useMemo(() => {
    const header = `# AICTE Approval Process Validation Rules\n# Active Version: ${versions[0]?.version || "v1.2"}\n# Configurable sample values, not official AICTE numbers.\n\nversion: ${versions[0]?.version.replace("v", "") || "1.2"}\nreference_date: 2026-10-26\n\nrules:\n`;
    const rulesYaml = rules
      .map((r) => {
        return `  - id: ${r.id}\n    kind: ${r.kind}\n    field: ${r.field}\n    condition: ${r.condition}\n    threshold: ${r.threshold} # configurable sample value, not official AICTE number\n    severity: ${r.severity}\n    message: >\n      ${r.message}\n    source_clause: >\n      ${r.source_clause}\n    application_types: [${r.application_types.join(", ")}]`;
      })
      .join("\n\n");
    return header + rulesYaml;
  }, [rules, versions]);

  return (
    <div style={{ maxWidth: "1500px", margin: "0 auto", padding: "16px 20px" }}>
      {/* Page Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "16px",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span style={{ fontSize: "11px", fontWeight: 700, color: "#004792", letterSpacing: "0.5px" }}>
              POLICY SPECIFICATION ENGINE
            </span>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 700,
                padding: "2px 7px",
                borderRadius: "10px",
                background: "#dcfce7",
                color: "#15803d",
                border: "1px solid #bbf7d0",
              }}
            >
              Active: {versions[0]?.version || "v1.2"}
            </span>
          </div>
          <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: "0 0 4px" }}>
            Rule Studio
          </h1>
          <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>
            Configurable validation rules for AICTE approval checks. All changes are logged to the cryptographic audit ledger.
          </p>
        </div>

        {/* Global Action Buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* Test on Sample Applications Button */}
          <button
            onClick={() => void handleTestOnSample()}
            disabled={isTesting}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: "#ffffff",
              color: "#0f172a",
              border: "1px solid #cbd5e1",
              borderRadius: "6px",
              padding: "7px 14px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: isTesting ? "wait" : "pointer",
              boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
            }}
          >
            <Play size={13} color="#004792" />
            <span>{isTesting ? "Testing on samples…" : "Test on sample applications"}</span>
          </button>

          {/* Publish Button (Admin only, audited) */}
          <button
            onClick={() => {
              if (isAdmin) setIsPublishModalOpen(true);
            }}
            disabled={!isAdmin}
            title={isAdmin ? "Publish rules as active policy" : "Only administrators can publish rules"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: isAdmin ? "#004792" : "#94a3b8",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              padding: "7px 14px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: isAdmin ? "pointer" : "not-allowed",
              boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
            }}
          >
            {isAdmin ? <UploadCloud size={14} /> : <Lock size={14} />}
            <span>{isAdmin ? "Publish" : "Publish (Admin only)"}</span>
          </button>
        </div>
      </div>

      {/* Status banner */}
      {statusMessage && (
        <div
          style={{
            padding: "8px 14px",
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: "6px",
            fontSize: "12px",
            fontWeight: 600,
            color: "#15803d",
            marginBottom: "14px",
          }}
        >
          ✓ {statusMessage}
        </div>
      )}

      {/* Sample Testing Results Callout (Before / After Finding Counts) */}
      {testResult && (
        <section
          style={{
            background: "#f8fafc",
            border: "1px solid #cbd5e1",
            borderRadius: "10px",
            padding: "16px 20px",
            marginBottom: "16px",
            animation: "fadeIn 0.2s ease",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Sparkles size={16} color="#004792" />
              <h2 style={{ fontSize: "14px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
                Sample Application Test Evaluation Results
              </h2>
            </div>
            <button
              onClick={() => setTestResult(null)}
              style={{ background: "transparent", border: "none", fontSize: "12px", color: "#64748b", cursor: "pointer" }}
            >
              Dismiss
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "12px",
              marginBottom: "14px",
            }}
          >
            <div style={{ background: "#ffffff", padding: "10px 14px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 600 }}>BEFORE (BASELINE RULES)</div>
              <div style={{ fontSize: "20px", fontWeight: 800, color: "#1e293b" }}>
                {testResult.before_count}{" "}
                <span style={{ fontSize: "12px", fontWeight: 500, color: "#64748b" }}>findings</span>
              </div>
            </div>

            <div style={{ background: "#ffffff", padding: "10px 14px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 600 }}>AFTER (TESTING DRAFT)</div>
              <div style={{ fontSize: "20px", fontWeight: 800, color: "#004792" }}>
                {testResult.after_count}{" "}
                <span style={{ fontSize: "12px", fontWeight: 500, color: "#64748b" }}>findings</span>
              </div>
            </div>

            <div style={{ background: "#ffffff", padding: "10px 14px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 600 }}>NET VARIANCE</div>
              <div
                style={{
                  fontSize: "20px",
                  fontWeight: 800,
                  color: testResult.diff < 0 ? "#15803d" : testResult.diff > 0 ? "#b91c1c" : "#64748b",
                }}
              >
                {testResult.diff > 0 ? `+${testResult.diff}` : testResult.diff}{" "}
                <span style={{ fontSize: "12px", fontWeight: 500 }}>
                  {testResult.diff < 0 ? "(Reduced false alerts)" : testResult.diff > 0 ? "(Additional flags)" : "(No net change)"}
                </span>
              </div>
            </div>
          </div>

          {/* Breakdown per sample application */}
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#475569", marginBottom: "6px" }}>
            BREAKDOWN PER SAMPLE APPLICATION:
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "8px" }}>
            {testResult.sample_applications.map((app) => (
              <div
                key={app.application_number}
                style={{
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "6px",
                  padding: "8px 10px",
                  fontSize: "11px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, color: "#1e293b", fontFamily: "monospace" }}>
                    {app.application_number}
                  </div>
                  <div style={{ color: "#64748b", fontSize: "10px" }}>{app.institution}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ color: "#64748b" }}>{app.before}</span> →{" "}
                  <strong style={{ color: "#004792" }}>{app.after}</strong>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Top Toolbar: Application-Type Filter (Replaced Search) & Tabs */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
          marginBottom: "16px",
          background: "#ffffff",
          border: "1px solid #cbd5e1",
          borderRadius: "8px",
          padding: "10px 14px",
        }}
      >
        {/* Application-Type Filter */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "12px", fontWeight: 700, color: "#334155" }}>Application Type:</span>
          <select
            value={appTypeFilter}
            onChange={(e) => setAppTypeFilter(e.target.value)}
            style={{
              padding: "6px 12px",
              borderRadius: "6px",
              border: "1px solid #cbd5e1",
              fontSize: "12px",
              color: "#1e293b",
              fontWeight: 500,
              background: "#f8fafc",
              cursor: "pointer",
            }}
          >
            <option value="all">All Application Types</option>
            <option value="new_institution">New Institution</option>
            <option value="extension_of_approval">Extension of Approval (EOA)</option>
            <option value="increase_in_intake">Increase in Intake</option>
            <option value="new_program">New Program / Division</option>
          </select>
          <span style={{ fontSize: "11px", color: "#64748b" }}>
            Showing {filteredRules.length} of {rules.length} rules
          </span>
        </div>

        {/* View Switcher Tabs: Form Editor vs Advanced (YAML) vs Version History */}
        <div style={{ display: "flex", gap: "4px", background: "#f1f5f9", padding: "3px", borderRadius: "6px" }}>
          <button
            onClick={() => setActiveTab("form")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              padding: "5px 12px",
              borderRadius: "4px",
              fontSize: "12px",
              fontWeight: activeTab === "form" ? 700 : 500,
              background: activeTab === "form" ? "#ffffff" : "transparent",
              color: activeTab === "form" ? "#004792" : "#64748b",
              border: "none",
              cursor: "pointer",
              boxShadow: activeTab === "form" ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
            }}
          >
            <Sliders size={13} />
            <span>Form Editor</span>
          </button>

          <button
            onClick={() => setActiveTab("advanced_yaml")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              padding: "5px 12px",
              borderRadius: "4px",
              fontSize: "12px",
              fontWeight: activeTab === "advanced_yaml" ? 700 : 500,
              background: activeTab === "advanced_yaml" ? "#ffffff" : "transparent",
              color: activeTab === "advanced_yaml" ? "#004792" : "#64748b",
              border: "none",
              cursor: "pointer",
              boxShadow: activeTab === "advanced_yaml" ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
            }}
          >
            <FileCode size={13} />
            <span>Advanced (YAML)</span>
          </button>

          <button
            onClick={() => setActiveTab("history")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              padding: "5px 12px",
              borderRadius: "4px",
              fontSize: "12px",
              fontWeight: activeTab === "history" ? 700 : 500,
              background: activeTab === "history" ? "#ffffff" : "transparent",
              color: activeTab === "history" ? "#004792" : "#64748b",
              border: "none",
              cursor: "pointer",
              boxShadow: activeTab === "history" ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
            }}
          >
            <History size={13} />
            <span>Version History ({versions.length})</span>
          </button>
        </div>
      </div>

      {/* Main Workspace Layout */}
      {activeTab === "form" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "340px 1fr",
            gap: "16px",
            alignItems: "start",
          }}
        >
          {/* Left Column: Rule Selector List */}
          <aside
            style={{
              background: "#ffffff",
              border: "1px solid #dcdad4",
              borderRadius: "10px",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "12px 16px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                Select Rule to Edit
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column" }}>
              {filteredRules.map((rule) => {
                const isSelected = rule.id === selectedRuleId;
                return (
                  <button
                    key={rule.id}
                    onClick={() => {
                      setSelectedRuleId(rule.id);
                      setFormDraft({ ...rule });
                    }}
                    style={{
                      padding: "12px 14px",
                      borderBottom: "1px solid #f1f5f9",
                      background: isSelected ? "#f0f7ff" : "#ffffff",
                      borderLeft: isSelected ? "3px solid #004792" : "3px solid transparent",
                      cursor: "pointer",
                      textAlign: "left",
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px",
                      borderTop: "none",
                      borderRight: "none",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "11px", fontFamily: "monospace", fontWeight: 700, color: "#004792" }}>
                        {rule.id}
                      </span>
                      <span
                        style={{
                          fontSize: "9px",
                          fontWeight: 700,
                          padding: "1px 5px",
                          borderRadius: "4px",
                          background:
                            rule.severity === "high" || rule.severity === "critical"
                              ? "#fee2e2"
                              : rule.severity === "medium"
                              ? "#fef3c7"
                              : "#e0f2fe",
                          color:
                            rule.severity === "high" || rule.severity === "critical"
                              ? "#991b1b"
                              : rule.severity === "medium"
                              ? "#92400e"
                              : "#0369a1",
                        }}
                      >
                        {rule.severity.toUpperCase()}
                      </span>
                    </div>

                    <div style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b" }}>
                      Field: <span style={{ fontFamily: "monospace" }}>{rule.field}</span>
                    </div>

                    <div
                      style={{
                        fontSize: "11px",
                        color: "#64748b",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {rule.message}
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Right Column: Form Editor per Rule */}
          <main
            style={{
              background: "#ffffff",
              border: "1px solid #dcdad4",
              borderRadius: "10px",
              padding: "20px 24px",
            }}
          >
            {/* Editor Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                borderBottom: "1px solid #e2e8f0",
                paddingBottom: "14px",
                marginBottom: "18px",
              }}
            >
              <div>
                <span style={{ fontSize: "11px", fontFamily: "monospace", color: "#64748b" }}>
                  RULE DEFINITION · {formDraft.kind}
                </span>
                <h2 style={{ fontSize: "18px", fontWeight: 800, color: "#0f172a", margin: "2px 0 0" }}>
                  {formDraft.id}
                </h2>
              </div>

              <button
                onClick={handleSaveRule}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  background: "#004792",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "6px",
                  padding: "7px 14px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <Save size={13} />
                <span>Save Rule Changes</span>
              </button>
            </div>

            {/* Form Fields Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "18px" }}>
              {/* Field 1: Target Field */}
              <div>
                <label style={{ fontSize: "12px", fontWeight: 700, color: "#334155", display: "block", marginBottom: "4px" }}>
                  Target Field
                </label>
                <input
                  type="text"
                  value={formDraft.field}
                  onChange={(e) => handleFieldChange("field", e.target.value)}
                  style={{
                    width: "100%",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    padding: "8px 10px",
                    fontSize: "12px",
                    fontFamily: "monospace",
                    background: "#f8fafc",
                  }}
                />
              </div>

              {/* Field 2: Condition / Check Operator */}
              <div>
                <label style={{ fontSize: "12px", fontWeight: 700, color: "#334155", display: "block", marginBottom: "4px" }}>
                  Condition / Operator
                </label>
                <select
                  value={formDraft.condition}
                  onChange={(e) => handleFieldChange("condition", e.target.value)}
                  style={{
                    width: "100%",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    padding: "8px 10px",
                    fontSize: "12px",
                    background: "#ffffff",
                  }}
                >
                  <option value="field_comparison">field_comparison (Exact field match)</option>
                  <option value="fuzzy_string_match">fuzzy_string_match (Levenshtein / Jaro-Winkler)</option>
                  <option value="fuzzy_address_match">fuzzy_address_match (Cadastral token overlap)</option>
                  <option value="on_or_after_reference_date">on_or_after_reference_date (Validity check)</option>
                  <option value="minimum_distinct_institutions">minimum_distinct_institutions (Cross-check)</option>
                  <option value="field_required_boolean">field_required_boolean (Attestation presence)</option>
                  <option value="all_required_present">all_required_present (Checklist schedule)</option>
                </select>
              </div>

              {/* Field 3: Threshold with Mandatory Disclaimer */}
              <div style={{ gridColumn: "span 2" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "#334155" }}>
                    Threshold
                  </label>
                  {/* Mandatory requirement: Label threshold values "configurable sample values, not official AICTE numbers" */}
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      color: "#b45309",
                      background: "#fffbeb",
                      border: "1px solid #fef3c7",
                      padding: "2px 8px",
                      borderRadius: "4px",
                    }}
                  >
                    ⚠ configurable sample values, not official AICTE numbers
                  </span>
                </div>
                <input
                  type="text"
                  value={String(formDraft.threshold)}
                  onChange={(e) => handleFieldChange("threshold", e.target.value)}
                  style={{
                    width: "100%",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    padding: "8px 10px",
                    fontSize: "12px",
                    fontFamily: "monospace",
                    background: "#ffffff",
                  }}
                />
                <p style={{ fontSize: "11px", color: "#64748b", margin: "4px 0 0" }}>
                  Evaluation boundary (e.g. 0.84 for string similarity, 180 for near-expiry days, or 2 for minimum distinct applications).
                </p>
              </div>

              {/* Field 4: Severity */}
              <div>
                <label style={{ fontSize: "12px", fontWeight: 700, color: "#334155", display: "block", marginBottom: "4px" }}>
                  Finding Severity
                </label>
                <select
                  value={formDraft.severity}
                  onChange={(e) => handleFieldChange("severity", e.target.value as EditableRule["severity"])}
                  style={{
                    width: "100%",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    padding: "8px 10px",
                    fontSize: "12px",
                    background: "#ffffff",
                  }}
                >
                  <option value="info">Info</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>

              {/* Field 5: Application Types */}
              <div>
                <label style={{ fontSize: "12px", fontWeight: 700, color: "#334155", display: "block", marginBottom: "4px" }}>
                  Applicable Application Types
                </label>
                <div style={{ fontSize: "11px", color: "#64748b", padding: "8px 0" }}>
                  {formDraft.application_types.join(", ")}
                </div>
              </div>

              {/* Field 6: Message (Finding Reason) */}
              <div style={{ gridColumn: "span 2" }}>
                <label style={{ fontSize: "12px", fontWeight: 700, color: "#334155", display: "block", marginBottom: "4px" }}>
                  Finding Message / Explanation
                </label>
                <textarea
                  rows={2}
                  value={formDraft.message}
                  onChange={(e) => handleFieldChange("message", e.target.value)}
                  style={{
                    width: "100%",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    padding: "8px 10px",
                    fontSize: "12px",
                    fontFamily: "inherit",
                    lineHeight: 1.4,
                  }}
                />
                <p style={{ fontSize: "11px", color: "#64748b", margin: "4px 0 0" }}>
                  Shown to the scrutiny officer and applicant. Always state as an indicator requiring human verification.
                </p>
              </div>

              {/* Field 7: Source Clause Text */}
              <div style={{ gridColumn: "span 2" }}>
                <label style={{ fontSize: "12px", fontWeight: 700, color: "#334155", display: "block", marginBottom: "4px" }}>
                  Source Clause Text (Statutory Authority Citation)
                </label>
                <textarea
                  rows={2}
                  value={formDraft.source_clause}
                  onChange={(e) => handleFieldChange("source_clause", e.target.value)}
                  style={{
                    width: "100%",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    padding: "8px 10px",
                    fontSize: "12px",
                    fontFamily: "inherit",
                    lineHeight: 1.4,
                    background: "#f8fafc",
                  }}
                />
              </div>
            </div>
          </main>
        </div>
      )}

      {/* Advanced (YAML) Read-Only View */}
      {activeTab === "advanced_yaml" && (
        <section
          style={{
            background: "#ffffff",
            border: "1px solid #dcdad4",
            borderRadius: "10px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "12px 18px",
              background: "#1e293b",
              color: "#f8fafc",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <FileCode size={16} color="#38bdf8" />
              <span style={{ fontSize: "13px", fontWeight: 700 }}>
                Advanced YAML View (Read-Only)
              </span>
            </div>
            <span
              style={{
                fontSize: "11px",
                color: "#fef3c7",
                background: "#78350f",
                padding: "2px 8px",
                borderRadius: "4px",
              }}
            >
              configurable sample values, not official AICTE numbers
            </span>
          </div>

          <pre
            style={{
              margin: 0,
              padding: "20px 24px",
              background: "#0f172a",
              color: "#e2e8f0",
              fontSize: "12px",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              lineHeight: 1.6,
              overflowX: "auto",
              maxHeight: "550px",
            }}
          >
            {generatedYaml}
          </pre>
        </section>
      )}

      {/* Version History Tab */}
      {activeTab === "history" && (
        <section
          style={{
            background: "#ffffff",
            border: "1px solid #dcdad4",
            borderRadius: "10px",
            padding: "20px 24px",
          }}
        >
          <div style={{ marginBottom: "16px" }}>
            <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
              Rule Configuration Version History
            </h2>
            <p style={{ fontSize: "12px", color: "#64748b", margin: "4px 0 0" }}>
              Every published version is cryptographically committed to the append-only audit ledger.
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {versions.map((v, idx) => (
              <div
                key={v.version}
                style={{
                  background: idx === 0 ? "#f0fdf4" : "#f8fafc",
                  border: idx === 0 ? "1px solid #86efac" : "1px solid #e2e8f0",
                  borderRadius: "8px",
                  padding: "14px 18px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                    <span style={{ fontSize: "14px", fontWeight: 800, color: "#004792", fontFamily: "monospace" }}>
                      {v.version}
                    </span>
                    {idx === 0 && (
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 700,
                          padding: "2px 6px",
                          background: "#dcfce7",
                          color: "#15803d",
                          borderRadius: "4px",
                        }}
                      >
                        CURRENT ACTIVE
                      </span>
                    )}
                    <span style={{ fontSize: "12px", color: "#64748b" }}>
                      Published by <strong>{v.author}</strong> on {new Date(v.published_at).toLocaleString()}
                    </span>
                  </div>

                  <p style={{ fontSize: "12px", color: "#334155", margin: "4px 0 0" }}>
                    <strong>Remarks:</strong> {v.remarks}
                  </p>
                </div>

                <div style={{ textAlign: "right" }}>
                  <span
                    style={{
                      fontSize: "11px",
                      color: "#64748b",
                      background: "#ffffff",
                      border: "1px solid #cbd5e1",
                      padding: "2px 8px",
                      borderRadius: "4px",
                    }}
                  >
                    {v.rules_count} active rules
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Publish Confirmation Modal (Admin only, audited) */}
      {isPublishModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "20px",
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: "10px",
              padding: "24px",
              maxWidth: "520px",
              width: "100%",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
              <ShieldCheck size={20} color="#004792" />
              <h3 style={{ fontSize: "17px", fontWeight: 800, color: "#0f172a", margin: 0 }}>
                Publish Active Rules Configuration
              </h3>
            </div>

            <p style={{ fontSize: "13px", color: "#475569", margin: "0 0 14px", lineHeight: 1.45 }}>
              Publishing will activate the modified rules across all applicant pre-checks and officer evaluation pipelines. This action is permanently audited in the hash-chained ledger.
            </p>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "12px", fontWeight: 700, color: "#334155", display: "block", marginBottom: "6px" }}>
                Officer Publication Remarks (Required for Audit Log)
              </label>
              <textarea
                rows={3}
                placeholder="Enter justification for this rule revision (e.g. Updated faculty similarity threshold per revised AICTE Council circular #401)..."
                value={publishRemarks}
                onChange={(e) => setPublishRemarks(e.target.value)}
                style={{
                  width: "100%",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  padding: "8px 10px",
                  fontSize: "12px",
                  fontFamily: "inherit",
                }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button
                onClick={() => setIsPublishModalOpen(false)}
                disabled={publishBusy}
                style={{
                  background: "#f1f5f9",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  padding: "7px 14px",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#475569",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>

              <button
                onClick={() => void handlePublish()}
                disabled={publishBusy || !publishRemarks.trim()}
                style={{
                  background: "#004792",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "6px",
                  padding: "7px 16px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: publishBusy || !publishRemarks.trim() ? "not-allowed" : "pointer",
                }}
              >
                {publishBusy ? "Publishing…" : "Confirm & Publish"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
