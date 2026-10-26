"use client";

import { useState, useEffect, useMemo } from "react";
import { Printer } from "lucide-react";
import type { NoticeRecord, NoticeStatus } from "@/lib/models";
import { getSupabaseClient } from "@/lib/supabase";

export function NoticesWorkspace() {
  const [notices, setNotices] = useState<NoticeRecord[]>([]);
  const [selectedNotice, setSelectedNotice] = useState<NoticeRecord | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      const client = getSupabaseClient();
      if (!client) {
        setError("Connect to Supabase to load notices.");
        setLoading(false);
        return;
      }
      try {
        const { data, error: loadError } = await client
          .from("deficiency_letters")
          .select("id, application_id, language, content, finding_ids, status, created_at, approved_at, approval_remarks")
          .order("created_at", { ascending: false });
        if (loadError) throw loadError;
        const rows = (data ?? []) as unknown as NoticeRecord[];
        setNotices(rows);
        setSelectedNotice((current) => rows.find((notice) => notice.id === current?.id) ?? rows[0] ?? null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Notices could not be loaded.");
        setNotices([]);
        setSelectedNotice(null);
      }
      setLoading(false);
    }
    void load();
  }, []);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return notices;
    return notices.filter((n) => n.status === statusFilter);
  }, [notices, statusFilter]);

  return (
    <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "16px 20px" }}>
      {/* Header */}
      <div style={{ marginBottom: "20px" }}>
        <span style={{ fontSize: "11px", fontWeight: 700, color: "#004792", letterSpacing: "0.5px" }}>
          OFFICER NOTICES
        </span>
        <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#1a2530", margin: "2px 0 0" }}>
          Deficiency Notices Workspace
        </h1>
        <p style={{ fontSize: "13px", color: "#64748b", margin: "4px 0 0" }}>
          Notices citing accepted findings for officer review and applicant response.
        </p>
      </div>

      {/* Filter Tabs: All, Draft, Approved, Responded */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        {[
          { id: "all", label: "All Notices" },
          { id: "draft", label: "Draft" },
          { id: "approved", label: "Approved" },
          { id: "responded", label: "Responded" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setStatusFilter(tab.id)}
            style={{
              padding: "6px 14px",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: statusFilter === tab.id ? 700 : 500,
              background: statusFilter === tab.id ? "#004792" : "#ffffff",
              color: statusFilter === tab.id ? "#ffffff" : "#475569",
              border: "1px solid #cbd5e1",
              cursor: "pointer",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Split: Left Notices List + Right Notice Preview */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1.2fr",
          gap: "16px",
          alignItems: "start",
        }}
      >
        {/* Left: Notices List */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {loading ? (
            <div style={{ background: "#ffffff", border: "1px solid #dcdad4", borderRadius: "10px", padding: "36px", textAlign: "center", color: "#64748b", fontSize: "13px" }}>
              Loading notices…
            </div>
          ) : error ? (
            <div role="alert" style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px", padding: "16px", color: "#991b1b", fontSize: "13px" }}>
              {error}
            </div>
          ) : filtered.length === 0 ? (
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #dcdad4",
                borderRadius: "10px",
                padding: "36px",
                textAlign: "center",
                color: "#94a3b8",
                fontSize: "13px",
              }}
            >
              No notices matching this status.
            </div>
          ) : (
            filtered.map((notice) => {
              const isSelected = selectedNotice?.id === notice.id;
              const statusColors: Record<NoticeStatus, { bg: string; text: string }> = {
                draft: { bg: "#f1f5f9", text: "#475569" },
                approved: { bg: "#ecfdf5", text: "#065f46" },
                responded: { bg: "#eff6ff", text: "#1e40af" },
              };
              const colors = statusColors[notice.status] || { bg: "#f1f5f9", text: "#475569" };

              return (
                <article
                  key={notice.id}
                  onClick={() => setSelectedNotice(notice)}
                  style={{
                    background: "#ffffff",
                    border: "1px solid #dcdad4",
                    borderLeft: isSelected ? "3px solid #004792" : "3px solid transparent",
                    borderRadius: "8px",
                    padding: "14px 16px",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "11px", fontWeight: 700, fontFamily: "monospace", color: "#004792" }}>
                        NOTICE #{notice.id.slice(0, 8)}
                      </span>
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 700,
                          padding: "1px 6px",
                          borderRadius: "8px",
                          background: colors.bg,
                          color: colors.text,
                          textTransform: "capitalize",
                        }}
                      >
                        {notice.status}
                      </span>
                    </div>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>
                      {new Date(notice.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  <p style={{ fontSize: "12px", color: "#334155", margin: 0, lineClamp: 2, overflow: "hidden" }}>
                    Language: <strong>{notice.language.toUpperCase()}</strong> · {notice.finding_ids?.length || 1} finding(s) cited
                  </p>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" }}>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>
                      {notice.approved_at ? `Approved on ${new Date(notice.approved_at).toLocaleDateString()}` : "Pending Approval"}
                    </span>
                    <span style={{ fontSize: "12px", color: "#004792", fontWeight: 600 }}>
                      View details →
                    </span>
                  </div>
                </article>
              );
            })
          )}
        </div>

        {/* Right: Notice Preview & Noto Sans Devanagari PDF Export */}
        {selectedNotice && (
          <section
            style={{
              background: "#ffffff",
              border: "1px solid #dcdad4",
              borderRadius: "10px",
              padding: "20px 24px",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div>
                <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
                  Statutory Notice Document
                </h2>
                <span style={{ fontSize: "11px", color: "#64748b" }}>
                  Language: {selectedNotice.language === "hi" ? "हिन्दी · machine-translated, review before sending" : "English"}
                </span>
              </div>

              <button
                onClick={() => window.print()}
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
                <Printer size={14} />
                <span>Print / save as PDF</span>
              </button>
            </div>

            {/* Document Content View */}
            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                padding: "18px 20px",
                fontSize: "13px",
                lineHeight: 1.6,
                color: "#1e293b",
                whiteSpace: "pre-wrap",
                fontFamily: "inherit",
                minHeight: "300px",
              }}
            >
              {selectedNotice.content}
            </div>

            {selectedNotice.approval_remarks && (
              <div
                style={{
                  marginTop: "16px",
                  padding: "10px 14px",
                  background: "#ecfdf5",
                  borderLeft: "3px solid #059669",
                  borderRadius: "0 6px 6px 0",
                  fontSize: "12px",
                  color: "#065f46",
                }}
              >
                <strong>Approval Remarks:</strong> {selectedNotice.approval_remarks}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
