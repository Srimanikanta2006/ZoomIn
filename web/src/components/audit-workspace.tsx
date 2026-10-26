"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  Download,
  Search,
  Filter,
  Calendar,
  User,
  Clock,
  Layers,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  ChevronRight,
  ExternalLink,
  Lock,
  RefreshCw,
  FileText,
  X,
} from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import type { Role } from "@/lib/models";

export interface AuditEntry {
  id: number;
  actor_id: string | null;
  actor_email?: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  occurred_at: string;
  details: Record<string, unknown>;
  prev_hash: string | null;
  hash: string;
}

interface IntegrityResult {
  valid: boolean;
  checked_count: number;
  first_invalid_id: number | null;
  checked_at: string;
  detail?: string;
}

export function AuditWorkspace({ role }: { role?: Role | null }) {
  const isAdmin = role === "admin";

  const [auditRows, setAuditRows] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");

  // Filters
  const [actorFilter, setActorFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("all"); // "all", "today", "7days", "30days"
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");

  // Row Drilldown modal
  const [selectedRow, setSelectedRow] = useState<AuditEntry | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  // Integrity Check
  const [verifying, setVerifying] = useState(false);
  const [integrity, setIntegrity] = useState<IntegrityResult | null>(null);

  // Fetch live audit entries from Supabase
  const loadAuditLog = async () => {
    setLoading(true);
    setError("");
    const supabase = getSupabaseClient();
    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    try {
      const { data, error: fetchErr } = await supabase
        .from("audit_log")
        .select("id, actor_id, action, entity_type, entity_id, occurred_at, details, prev_hash, hash")
        .order("id", { ascending: false })
        .limit(300);

      if (fetchErr) throw new Error(fetchErr.message);
      setAuditRows((data ?? []) as AuditEntry[]);
    } catch (e: unknown) {
      setAuditRows([]);
      setError(e instanceof Error ? e.message : "Could not read audit log.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAuditLog();
  }, []);

  // Filtered audit entries
  const filteredEntries = useMemo(() => {
    return auditRows.filter((entry) => {
      // 1. Actor filter
      if (actorFilter !== "all") {
        const actorMatch =
          entry.actor_email?.toLowerCase().includes(actorFilter.toLowerCase()) ||
          entry.actor_id?.toLowerCase().includes(actorFilter.toLowerCase());
        if (!actorMatch) return false;
      }

      // 2. Action filter
      if (actionFilter !== "all") {
        if (actionFilter === "login" && !entry.action.includes("login")) return false;
        if (actionFilter === "case_opened" && !entry.action.includes("case.opened")) return false;
        if (actionFilter === "finding_decision" && !entry.action.includes("finding") && !entry.action.includes("review")) return false;
        if (actionFilter === "notice_approval" && !entry.action.includes("notice")) return false;
        if (actionFilter === "rule_publish" && !entry.action.includes("rule")) return false;
        if (actionFilter === "export" && !entry.action.includes("export")) return false;
        if (actionFilter === "demo_reset" && !entry.action.includes("demo")) return false;
      }

      // 3. Date filter
      if (dateFilter !== "all") {
        const entryDate = new Date(entry.occurred_at).getTime();
        const now = Date.now();
        if (dateFilter === "today") {
          const oneDayAgo = now - 24 * 60 * 60 * 1000;
          if (entryDate < oneDayAgo) return false;
        } else if (dateFilter === "7days") {
          const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
          if (entryDate < sevenDaysAgo) return false;
        } else if (dateFilter === "30days") {
          const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
          if (entryDate < thirtyDaysAgo) return false;
        } else if (dateFilter === "custom") {
          if (customStartDate && entryDate < new Date(customStartDate).getTime()) return false;
          if (customEndDate && entryDate > new Date(customEndDate).getTime() + 24 * 60 * 60 * 1000) return false;
        }
      }

      return true;
    });
  }, [auditRows, actorFilter, actionFilter, dateFilter, customStartDate, customEndDate]);

  // CSV Export
  const handleExportCSV = async () => {
    if (!filteredEntries.length) return;
    setExportError("");
    const supabase = getSupabaseClient();
    if (!supabase) {
      setExportError("Supabase is not configured; the export was not created.");
      return;
    }
    const { error: auditError } = await supabase.rpc("append_audit_event", {
      p_action: "audit.csv_exported",
      p_details: { rows_count: filteredEntries.length, exported_at: new Date().toISOString() },
    });
    if (auditError) {
      setExportError(`Export was not created because it could not be audited: ${auditError.message}`);
      return;
    }

    const headers = [
      "ID",
      "Occurred At",
      "Actor ID",
      "Action",
      "Entity Type",
      "Entity ID",
      "Details",
      "Previous Hash",
      "Hash",
    ];

    const rows = filteredEntries.map((e) => [
      e.id,
      `"${e.occurred_at}"`,
      `"${e.actor_email || e.actor_id || "system"}"`,
      `"${e.action}"`,
      `"${e.entity_type}"`,
      `"${e.entity_id || ""}"`,
      `"${JSON.stringify(e.details).replace(/"/g, '""')}"`,
      `"${e.prev_hash || "root"}"`,
      `"${e.hash}"`,
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `zoomin_audit_log_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Verify Integrity
  const handleVerifyIntegrity = async () => {
    setVerifying(true);
    setIntegrity(null);

    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase is not configured.");
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !data.session) throw new Error("Sign in to verify the audit chain.");
      const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:7860").replace(/\/$/, "");
      const res = await fetch(`${apiUrl}/audit/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session.access_token}`,
        },
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Audit integrity could not be checked.");
      setIntegrity(await res.json() as IntegrityResult);
    } catch (cause) {
      setIntegrity({
        valid: false,
        checked_count: 0,
        first_invalid_id: null,
        checked_at: new Date().toISOString(),
        detail: cause instanceof Error ? cause.message : "Audit integrity could not be checked.",
      });
    } finally {
      setVerifying(false);
    }
  };

  // Copy hash helper
  const handleCopyHash = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedHash(key);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  // Non-admin guard
  if (!isAdmin) {
    return (
      <div style={{ maxWidth: "800px", margin: "40px auto", padding: "24px", textAlign: "center" }}>
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #cbd5e1",
            borderRadius: "10px",
            padding: "40px 24px",
            boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)",
          }}
        >
          <Lock size={36} color="#004792" style={{ margin: "0 auto 12px" }} />
          <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#1e293b", margin: "0 0 8px" }}>
            Admin Access Required
          </h2>
          <p style={{ fontSize: "13px", color: "#64748b", maxWidth: "480px", margin: "0 auto 16px", lineHeight: 1.5 }}>
            The global audit ledger and cryptographic verification tools are restricted to Administrators.
            Scrutiny and Regional Officers review per-case audit trails under each Case File History tab.
          </p>
          <a
            href="/officer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: "#004792",
              color: "#ffffff",
              padding: "8px 16px",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            <span>Return to Officer Queue</span>
            <ChevronRight size={14} />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "16px 20px" }}>
      {/* Header */}
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
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3px" }}>
            <span style={{ fontSize: "11px", fontWeight: 700, color: "#004792", letterSpacing: "0.5px" }}>
              CRYPTOGRAPHIC SYSTEM AUDIT
            </span>
            <span
              style={{
                fontSize: "10px",
                padding: "2px 6px",
                background: "#f0fdf4",
                color: "#166534",
                borderRadius: "4px",
                fontWeight: 600,
              }}
            >
              Hash-Chained & Append-Only
            </span>
          </div>
          <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: "0 0 4px" }}>
            Global Audit Ledger
          </h1>
          <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>
            Strictly audited actions: sign-in, case opened, finding decisions, notice approvals, rule publishes, exports, and demo resets.
          </p>
        </div>

        {/* Header Actions: Verify Integrity & CSV Export */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={() => void loadAuditLog()}
            disabled={loading}
            className="review-secondary"
          >
            <RefreshCw size={14} />
            <span>{loading ? "Loading…" : "Reload"}</span>
          </button>
          <button
            onClick={() => void handleVerifyIntegrity()}
            disabled={verifying}
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
              cursor: verifying ? "wait" : "pointer",
              boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
            }}
          >
            <ShieldCheck size={14} color="#004792" />
            <span>{verifying ? "Verifying chain…" : "Verify Integrity"}</span>
          </button>

          <button
            onClick={() => void handleExportCSV()}
            disabled={!filteredEntries.length}
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
              cursor: filteredEntries.length ? "pointer" : "not-allowed",
              boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
            }}
          >
            <Download size={14} />
            <span>Export CSV</span>
          </button>
        </div>
      </div>
      {exportError && <p className="review-error" role="alert">{exportError}</p>}

      {/* Integrity Result Status Banner */}
      {integrity && (
        <div
          style={{
            padding: "12px 18px",
            borderRadius: "8px",
            marginBottom: "16px",
            border: integrity.valid ? "1px solid #86efac" : "1px solid #fca5a5",
            background: integrity.valid ? "#f0fdf4" : "#fef2f2",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {integrity.valid ? (
              <CheckCircle2 size={18} color="#15803d" />
            ) : (
              <XCircle size={18} color="#b91c1c" />
            )}
            <div>
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: 700,
                  color: integrity.valid ? "#166534" : "#991b1b",
                }}
              >
                {integrity.valid
                  ? "Chain Integrity Confirmed: PASS"
                  : integrity.first_invalid_id
                  ? `Chain Integrity Tampered: FAIL (First broken row: Entry #${integrity.first_invalid_id})`
                  : "Integrity check unavailable"}
              </div>
              <div style={{ fontSize: "11px", color: "#475569" }}>
                {integrity.detail || `${integrity.checked_count} cryptographic entries evaluated · Checked at ${new Date(integrity.checked_at).toLocaleTimeString()}`}
              </div>
            </div>
          </div>

          <button
            onClick={() => setIntegrity(null)}
            style={{ background: "transparent", border: "none", color: "#64748b", cursor: "pointer" }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Filter Bar (Actor, Action, Date) */}
      <section
        style={{
          background: "#ffffff",
          border: "1px solid #cbd5e1",
          borderRadius: "8px",
          padding: "12px 16px",
          marginBottom: "16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          {/* Action Filter */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "#475569" }}>Action:</span>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              style={{
                fontSize: "12px",
                padding: "5px 10px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                background: "#f8fafc",
                fontWeight: 500,
              }}
            >
              <option value="all">All Actions</option>
              <option value="login">Login (auth.login)</option>
              <option value="case_opened">Case Opened (case.opened)</option>
              <option value="finding_decision">Finding Decisions</option>
              <option value="notice_approval">Notice Approvals</option>
              <option value="rule_publish">Rule Publishes</option>
              <option value="export">Exports (PDF / CSV)</option>
              <option value="demo_reset">Demo Resets</option>
            </select>
          </div>

          {/* Actor Filter */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "#475569" }}>Actor:</span>
            <select
              value={actorFilter}
              onChange={(e) => setActorFilter(e.target.value)}
              style={{
                fontSize: "12px",
                padding: "5px 10px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                background: "#f8fafc",
                fontWeight: 500,
              }}
            >
              <option value="all">All Actors</option>
              <option value="admin">Administrators</option>
              <option value="officer">Scrutiny Officers</option>
              <option value="system">System</option>
            </select>
          </div>

          {/* Date Filter */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "#475569" }}>Date Range:</span>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              style={{
                fontSize: "12px",
                padding: "5px 10px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                background: "#f8fafc",
                fontWeight: 500,
              }}
            >
              <option value="all">All Time</option>
              <option value="today">Today (Last 24h)</option>
              <option value="7days">Last 7 Days</option>
              <option value="30days">Last 30 Days</option>
            </select>
          </div>
        </div>

        <div style={{ fontSize: "12px", color: "#64748b" }}>
          Showing <strong>{filteredEntries.length}</strong> audited events (Click row to inspect hashes)
        </div>
      </section>

      {/* Audit Log Table */}
      <section
        style={{
          background: "#ffffff",
          border: "1px solid #cbd5e1",
          borderRadius: "10px",
          overflow: "hidden",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", textAlign: "left" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #cbd5e1", color: "#475569" }}>
                <th style={{ padding: "10px 14px", fontWeight: 700 }}>ID</th>
                <th style={{ padding: "10px 14px", fontWeight: 700 }}>Timestamp</th>
                <th style={{ padding: "10px 14px", fontWeight: 700 }}>Action</th>
                <th style={{ padding: "10px 14px", fontWeight: 700 }}>Actor</th>
                <th style={{ padding: "10px 14px", fontWeight: 700 }}>Entity</th>
                <th style={{ padding: "10px 14px", fontWeight: 700 }}>Event Payload</th>
                <th style={{ padding: "10px 14px", fontWeight: 700 }}>Hash Linkage</th>
                <th style={{ padding: "10px 14px", fontWeight: 700, textAlign: "center" }}>Drilldown</th>
              </tr>
            </thead>
            <tbody>
              {loading || error || filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: "40px", textAlign: "center", color: "#94a3b8" }}>
                    {loading ? "Loading audit entries…" : error || "No audit entries matching filter criteria."}
                  </td>
                </tr>
              ) : (
                filteredEntries.map((row, idx) => {
                  const isSelected = selectedRow?.id === row.id;

                  const actionBadge = (
                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 700,
                        padding: "2px 6px",
                        borderRadius: "4px",
                        background: row.action.includes("publish")
                          ? "#eff6ff"
                          : row.action.includes("decision")
                          ? "#f0fdf4"
                          : row.action.includes("notice")
                          ? "#fef3c7"
                          : "#f1f5f9",
                        color: row.action.includes("publish")
                          ? "#1e40af"
                          : row.action.includes("decision")
                          ? "#166534"
                          : row.action.includes("notice")
                          ? "#92400e"
                          : "#334155",
                      }}
                    >
                      {row.action}
                    </span>
                  );

                  return (
                    <tr
                      key={row.id}
                      onClick={() => setSelectedRow(row)}
                      style={{
                        borderBottom: idx === filteredEntries.length - 1 ? "none" : "1px solid #f1f5f9",
                        background: isSelected ? "#f0f7ff" : idx % 2 === 0 ? "#ffffff" : "#fafaf9",
                        cursor: "pointer",
                      }}
                    >
                      <td style={{ padding: "10px 14px", fontFamily: "monospace", fontWeight: 700, color: "#64748b" }}>
                        #{row.id}
                      </td>
                      <td style={{ padding: "10px 14px", whiteSpace: "nowrap", color: "#334155" }}>
                        {new Date(row.occurred_at).toLocaleString()}
                      </td>
                      <td style={{ padding: "10px 14px" }}>{actionBadge}</td>
                      <td style={{ padding: "10px 14px", fontFamily: "monospace", color: "#004792", fontSize: "11px" }}>
                        {row.actor_email || (row.actor_id ? `${row.actor_id.slice(0, 8)}…` : "system")}
                      </td>
                      <td style={{ padding: "10px 14px", color: "#475569" }}>
                        {row.entity_type} {row.entity_id && <strong style={{ color: "#1e293b" }}>({row.entity_id})</strong>}
                      </td>
                      <td style={{ padding: "10px 14px", maxWidth: "260px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#64748b" }}>
                        {JSON.stringify(row.details)}
                      </td>
                      <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: "11px" }}>
                        <div style={{ color: "#64748b" }}>prev: {row.prev_hash ? `${row.prev_hash.slice(0, 8)}…` : "root"}</div>
                        <div style={{ color: "#004792", fontWeight: 700 }}>hash: {row.hash.slice(0, 8)}…</div>
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "center" }}>
                        <ChevronRight size={14} color={isSelected ? "#004792" : "#94a3b8"} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Row Drilldown Modal / Drawer showing hashes */}
      {selectedRow && (
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
              maxWidth: "680px",
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                borderBottom: "1px solid #e2e8f0",
                paddingBottom: "14px",
                marginBottom: "16px",
              }}
            >
              <div>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "#004792", letterSpacing: "0.5px" }}>
                  AUDIT ENTRY DRILLDOWN · #{selectedRow.id}
                </span>
                <h3 style={{ fontSize: "18px", fontWeight: 800, color: "#0f172a", margin: "2px 0 0" }}>
                  {selectedRow.action}
                </h3>
              </div>
              <button
                onClick={() => setSelectedRow(null)}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: "#64748b" }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Timestamp & Actor info */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "12px",
                background: "#f8fafc",
                padding: "12px 14px",
                borderRadius: "8px",
                marginBottom: "16px",
                fontSize: "12px",
              }}
            >
              <div>
                <span style={{ color: "#64748b", fontWeight: 600 }}>Timestamp:</span>
                <div style={{ color: "#1e293b", fontWeight: 700, marginTop: "2px" }}>
                  {new Date(selectedRow.occurred_at).toLocaleString()}
                </div>
                <div style={{ fontSize: "10px", color: "#64748b", fontFamily: "monospace" }}>
                  {selectedRow.occurred_at}
                </div>
              </div>

              <div>
                <span style={{ color: "#64748b", fontWeight: 600 }}>Actor:</span>
                <div style={{ color: "#004792", fontWeight: 700, marginTop: "2px" }}>
                  {selectedRow.actor_email || "System Actor"}
                </div>
                <div style={{ fontSize: "10px", color: "#64748b", fontFamily: "monospace" }}>
                  {selectedRow.actor_id || "system"}
                </div>
              </div>
            </div>

            {/* Cryptographic Hashes Drilldown */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "8px" }}>
                Cryptographic SHA-256 Hashes:
              </div>

              {/* Previous Hash */}
              <div style={{ marginBottom: "10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "3px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "#64748b" }}>
                    Previous Row Hash (prev_hash):
                  </span>
                  {selectedRow.prev_hash && (
                    <button
                      onClick={() => handleCopyHash(selectedRow.prev_hash!, "prev")}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: copiedHash === "prev" ? "#16a34a" : "#004792",
                        cursor: "pointer",
                        fontSize: "11px",
                        display: "flex",
                        alignItems: "center",
                        gap: "3px",
                      }}
                    >
                      {copiedHash === "prev" ? <Check size={12} /> : <Copy size={12} />}
                      <span>{copiedHash === "prev" ? "Copied" : "Copy"}</span>
                    </button>
                  )}
                </div>
                <div
                  style={{
                    background: "#0f172a",
                    color: "#38bdf8",
                    fontFamily: "monospace",
                    fontSize: "11px",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    wordBreak: "break-all",
                  }}
                >
                  {selectedRow.prev_hash || "ROOT_GENESIS_BLOCK_000000000000000000000000000000000000000000000000"}
                </div>
              </div>

              {/* Current Hash */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "3px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "#64748b" }}>
                    Current Row Hash (hash):
                  </span>
                  <button
                    onClick={() => handleCopyHash(selectedRow.hash, "curr")}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: copiedHash === "curr" ? "#16a34a" : "#004792",
                      cursor: "pointer",
                      fontSize: "11px",
                      display: "flex",
                      alignItems: "center",
                      gap: "3px",
                    }}
                  >
                    {copiedHash === "curr" ? <Check size={12} /> : <Copy size={12} />}
                    <span>{copiedHash === "curr" ? "Copied" : "Copy"}</span>
                  </button>
                </div>
                <div
                  style={{
                    background: "#0f172a",
                    color: "#4ade80",
                    fontFamily: "monospace",
                    fontSize: "11px",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    wordBreak: "break-all",
                  }}
                >
                  {selectedRow.hash}
                </div>
              </div>
            </div>

            {/* Event Payload Details */}
            <div style={{ marginBottom: "18px" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "6px" }}>
                Event Payload JSON:
              </div>
              <pre
                style={{
                  background: "#f8fafc",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  padding: "10px 12px",
                  fontSize: "11px",
                  fontFamily: "monospace",
                  maxHeight: "160px",
                  overflowY: "auto",
                  margin: 0,
                }}
              >
                {JSON.stringify(selectedRow.details, null, 2)}
              </pre>
            </div>

            {/* Close button */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => setSelectedRow(null)}
                style={{
                  background: "#004792",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "6px",
                  padding: "7px 16px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Close Drilldown
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
