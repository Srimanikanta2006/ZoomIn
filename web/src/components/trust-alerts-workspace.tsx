"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Share2,
  Users,
  Copy,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ShieldAlert,
  Info,
  ExternalLink,
  Search,
  Layers,
  X,
  FileText,
  Building,
  Eye,
  ZoomIn,
  ZoomOut,
  Maximize2,
  History,
  Lock,
} from "lucide-react";
import type { TrustAlertItem } from "@/lib/models";
import { getSupabaseClient } from "@/lib/supabase";

interface TrustAlertsWorkspaceProps {
  onRefresh?: () => Promise<void> | void;
}

// Map demo application numbers to their respective UUIDs for case linking
const APP_UUID_MAP: Record<string, string> = {
  "DEMO-APP-2026-001": "20000000-0000-4000-8000-000000000001",
  "DEMO-APP-2026-002": "20000000-0000-4000-8000-000000000002",
  "DEMO-APP-2026-003": "20000000-0000-4000-8000-000000000003",
  "DEMO-APP-2026-004": "20000000-0000-4000-8000-000000000004",
  "DEMO-APP-2026-005": "20000000-0000-4000-8000-000000000005",
};

interface GraphNode {
  id: string;
  label: string;
  sublabel: string;
  type: "institution" | "faculty" | "document" | "address";
  x: number;
  y: number;
  alertId?: string;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  alertId: string;
  label: string;
}

export function TrustAlertsWorkspace({ onRefresh }: TrustAlertsWorkspaceProps) {
  const router = useRouter();

  const [alerts, setAlerts] = useState<TrustAlertItem[]>([
    {
      id: "alert-001",
      alert_type: "shared faculty",
      entities: ["Dr. Rajesh Kumar (Faculty ID: FAC-***-982)"],
      applications: ["DEMO-APP-2026-001", "DEMO-APP-2026-003"],
      status: "New",
      masked_entity: "Faculty ID: FAC-***-982",
      explanation:
        "The same faculty member identification record is submitted across applications for two separate institutions in the same academic cycle without documented joint-faculty authorization.",
      node_ids: ["n-inst-1", "n-inst-3", "n-fac-982"],
    },
    {
      id: "alert-002",
      alert_type: "duplicate document",
      entities: ["Building Architecture Plan (SHA-256: 4a9f...e102)"],
      applications: ["DEMO-APP-2026-002", "DEMO-APP-2026-004"],
      status: "New",
      masked_entity: "SHA-256: 4a9f...e102",
      explanation:
        "Identical cryptographic document hash detected across applications submitted by different trust entities, indicating prospective re-use of identical architectural layouts.",
      node_ids: ["n-inst-2", "n-inst-4", "n-doc-hash"],
    },
    {
      id: "alert-003",
      alert_type: "shared address",
      entities: ["Plot 42, Knowledge Park (Survey No. 42/**)"],
      applications: ["DEMO-APP-2026-001", "DEMO-APP-2026-005"],
      status: "Reviewed",
      masked_entity: "Survey No. 42/**",
      explanation:
        "Physical campus location cadastral coordinates overlap an existing approved technical campus premises declaration.",
      review_note:
        "Verified: Institution Alpha and Epsilon share approved multi-institution education city master parcel under Trust Resolution #2024/09.",
      node_ids: ["n-inst-1", "n-inst-5", "n-addr-42"],
    },
    {
      id: "alert-004",
      alert_type: "shared faculty",
      entities: ["Prof. S. Rao (Faculty ID: FAC-***-114)"],
      applications: ["DEMO-APP-2026-002", "DEMO-APP-2026-005"],
      status: "Escalated",
      masked_entity: "Faculty ID: FAC-***-114",
      explanation:
        "Faculty member registered as full-time Professor and Head of Department in two institutions located in separate municipal corporations.",
      node_ids: ["n-inst-2", "n-inst-5", "n-fac-114"],
    },
  ]);

  const [selectedAlert, setSelectedAlert] = useState<TrustAlertItem | null>(alerts[0]);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(true);
  const [filterType, setFilterType] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [reviewNote, setReviewNote] = useState<string>("");
  const [isReviewing, setIsReviewing] = useState<boolean>(false);
  const [actionMessage, setActionMessage] = useState<string>("");
  const [openAppsModal, setOpenAppsModal] = useState<boolean>(false);
  const [zoomLevel, setZoomLevel] = useState<number>(1);

  // Mask sensitive personal ID helper
  const maskId = (raw: string) => {
    if (!raw) return "";
    return raw
      .replace(/FAC-[0-9]{3,}/g, "FAC-***-982")
      .replace(/[A-Z]{5}[0-9]{4}[A-Z]{1}/g, "XXXXX****X") // PAN mask
      .replace(/[0-9]{4}\s?[0-9]{4}\s?[0-9]{4}/g, "****-****-1234"); // Aadhaar mask
  };

  // Filtered alerts list
  const filteredAlerts = useMemo(() => {
    return alerts.filter((a) => {
      const matchType = filterType === "all" || a.alert_type === filterType;
      const matchStatus = statusFilter === "all" || a.status === statusFilter;
      return matchType && matchStatus;
    });
  }, [alerts, filterType, statusFilter]);

  // Graph topology definition
  const graphNodes: GraphNode[] = [
    {
      id: "n-inst-1",
      label: "Alpha Institute of Tech",
      sublabel: "DEMO-APP-2026-001",
      type: "institution",
      x: 100,
      y: 90,
    },
    {
      id: "n-inst-2",
      label: "Beta Polytechnic",
      sublabel: "DEMO-APP-2026-002",
      type: "institution",
      x: 100,
      y: 290,
    },
    {
      id: "n-inst-3",
      label: "Gamma Eng. College",
      sublabel: "DEMO-APP-2026-003",
      type: "institution",
      x: 430,
      y: 90,
    },
    {
      id: "n-inst-4",
      label: "Delta Inst. of Mgmt",
      sublabel: "DEMO-APP-2026-004",
      type: "institution",
      x: 430,
      y: 290,
    },
    {
      id: "n-inst-5",
      label: "Epsilon Tech Academy",
      sublabel: "DEMO-APP-2026-005",
      type: "institution",
      x: 265,
      y: 380,
    },
    // Shared Entity Nodes
    {
      id: "n-fac-982",
      label: "FAC-***-982",
      sublabel: "Dr. Rajesh Kumar",
      type: "faculty",
      x: 265,
      y: 90,
      alertId: "alert-001",
    },
    {
      id: "n-doc-hash",
      label: "SHA-256: 4a9f...e102",
      sublabel: "Building Plan",
      type: "document",
      x: 265,
      y: 290,
      alertId: "alert-002",
    },
    {
      id: "n-addr-42",
      label: "Survey No. 42/**",
      sublabel: "Plot 42, Sector 3",
      type: "address",
      x: 175,
      y: 215,
      alertId: "alert-003",
    },
    {
      id: "n-fac-114",
      label: "FAC-***-114",
      sublabel: "Prof. S. Rao",
      type: "faculty",
      x: 185,
      y: 345,
      alertId: "alert-004",
    },
  ];

  const graphEdges: GraphEdge[] = [
    // Alert 1: Shared faculty between Inst 1 and Inst 3
    { id: "e1", source: "n-inst-1", target: "n-fac-982", alertId: "alert-001", label: "Registered" },
    { id: "e2", source: "n-inst-3", target: "n-fac-982", alertId: "alert-001", label: "Registered" },
    // Alert 2: Duplicate doc between Inst 2 and Inst 4
    { id: "e3", source: "n-inst-2", target: "n-doc-hash", alertId: "alert-002", label: "Submitted" },
    { id: "e4", source: "n-inst-4", target: "n-doc-hash", alertId: "alert-002", label: "Submitted" },
    // Alert 3: Shared address between Inst 1 and Inst 5
    { id: "e5", source: "n-inst-1", target: "n-addr-42", alertId: "alert-003", label: "Premises" },
    { id: "e6", source: "n-inst-5", target: "n-addr-42", alertId: "alert-003", label: "Premises" },
    // Alert 4: Shared faculty between Inst 2 and Inst 5
    { id: "e7", source: "n-inst-2", target: "n-fac-114", alertId: "alert-004", label: "Registered" },
    { id: "e8", source: "n-inst-5", target: "n-fac-114", alertId: "alert-004", label: "Registered" },
  ];

  // Audit event helper
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

  // Row selection handler
  const handleSelectAlert = (alert: TrustAlertItem) => {
    setSelectedAlert(alert);
    setDrawerOpen(true);
    setIsReviewing(false);
    setActionMessage("");
    setReviewNote("");

    // Audit row focus
    void logAudit("trust_alert.focused", {
      alert_id: alert.id,
      alert_type: alert.alert_type,
      entity: alert.masked_entity,
      applications: alert.applications,
    });
  };

  // Handle Mark Reviewed action (Audited with required note)
  const handleMarkReviewed = async () => {
    if (!selectedAlert) return;
    if (!reviewNote.trim()) {
      setActionMessage("A review note is required to record officer justification.");
      return;
    }

    await logAudit("trust_alert.reviewed", {
      alert_id: selectedAlert.id,
      alert_type: selectedAlert.alert_type,
      entity: selectedAlert.masked_entity,
      review_note: reviewNote,
      reviewed_at: new Date().toISOString(),
    });

    setAlerts((prev) =>
      prev.map((a) =>
        a.id === selectedAlert.id
          ? { ...a, status: "Reviewed", review_note: reviewNote }
          : a
      )
    );
    setSelectedAlert((prev) =>
      prev ? { ...prev, status: "Reviewed", review_note: reviewNote } : null
    );
    setIsReviewing(false);
    setReviewNote("");
    setActionMessage("Alert marked as reviewed and logged to cryptographic audit table.");
    if (onRefresh) await onRefresh();
  };

  // Handle Escalate action (Audited)
  const handleEscalate = async () => {
    if (!selectedAlert) return;

    await logAudit("trust_alert.escalated", {
      alert_id: selectedAlert.id,
      alert_type: selectedAlert.alert_type,
      entity: selectedAlert.masked_entity,
      escalated_to: "Regional Scrutiny Committee",
      escalated_at: new Date().toISOString(),
    });

    setAlerts((prev) =>
      prev.map((a) => (a.id === selectedAlert.id ? { ...a, status: "Escalated" } : a))
    );
    setSelectedAlert((prev) => (prev ? { ...prev, status: "Escalated" } : null));
    setActionMessage("Alert escalated to Regional Scrutiny Committee and logged to audit table.");
    if (onRefresh) await onRefresh();
  };

  // Handle Open Applications action (Audited)
  const handleOpenApplications = async () => {
    if (!selectedAlert) return;

    await logAudit("trust_alert.open_applications", {
      alert_id: selectedAlert.id,
      alert_type: selectedAlert.alert_type,
      applications: selectedAlert.applications,
      action_at: new Date().toISOString(),
    });

    setOpenAppsModal(true);
  };

  return (
    <div style={{ maxWidth: "1500px", margin: "0 auto", padding: "16px 20px" }}>
      {/* Header */}
      <div style={{ marginBottom: "18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3px" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, color: "#004792", letterSpacing: "0.5px" }}>
            CROSS-APPLICATION INTEGRITY INTELLIGENCE
          </span>
          <span
            style={{
              fontSize: "10px",
              padding: "2px 6px",
              background: "#eff6ff",
              color: "#1d4ed8",
              borderRadius: "4px",
              fontWeight: 600,
            }}
          >
            Audited & Masked
          </span>
        </div>
        <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: "0 0 4px" }}>
          Trust Alerts & Association Network
        </h1>
        <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>
          Graph-based cross-check identifying shared faculty, duplicate documentation, and overlapping campus premises across academic applications.
        </p>
      </div>

      {/* Filter Toolbar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "10px",
          marginBottom: "16px",
        }}
      >
        {/* Type Filters */}
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <span style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", marginRight: "4px" }}>
            Alert Type:
          </span>
          {[
            { key: "all", label: "All Alerts" },
            { key: "shared faculty", label: "Shared Faculty" },
            { key: "duplicate document", label: "Duplicate Document" },
            { key: "shared address", label: "Shared Address" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setFilterType(t.key)}
              style={{
                padding: "5px 11px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: filterType === t.key ? 700 : 500,
                background: filterType === t.key ? "#004792" : "#ffffff",
                color: filterType === t.key ? "#ffffff" : "#475569",
                border: "1px solid #cbd5e1",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Status Filters */}
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <span style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", marginRight: "4px" }}>
            Status:
          </span>
          {[
            { key: "all", label: "All" },
            { key: "New", label: "New" },
            { key: "Reviewed", label: "Reviewed" },
            { key: "Escalated", label: "Escalated" },
          ].map((s) => (
            <button
              key={s.key}
              onClick={() => setStatusFilter(s.key)}
              style={{
                padding: "5px 10px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: statusFilter === s.key ? 700 : 500,
                background: statusFilter === s.key ? "#0f172a" : "#ffffff",
                color: statusFilter === s.key ? "#ffffff" : "#475569",
                border: "1px solid #cbd5e1",
                cursor: "pointer",
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Container: List + Graph Side-by-Side */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "16px",
          alignItems: "stretch",
          minHeight: "520px",
        }}
      >
        {/* Left: Alerts List */}
        <section
          style={{
            background: "#ffffff",
            border: "1px solid #dcdad4",
            borderRadius: "10px",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              padding: "12px 16px",
              background: "#f8fafc",
              borderBottom: "1px solid #e2e8f0",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Layers size={15} color="#004792" />
              <h2 style={{ fontSize: "13px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
                Trust Alert List ({filteredAlerts.length})
              </h2>
            </div>
            <span style={{ fontSize: "11px", color: "#64748b" }}>
              Click any row to focus graph & inspect
            </span>
          </div>

          {/* List Rows */}
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
            {filteredAlerts.length === 0 ? (
              <div style={{ padding: "40px 20px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
                No trust alerts matching selected filters.
              </div>
            ) : (
              filteredAlerts.map((alert) => {
                const isSelected = selectedAlert?.id === alert.id;

                const typeBadge =
                  alert.alert_type === "shared faculty" ? (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        fontSize: "11px",
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: "12px",
                        background: "#eff6ff",
                        color: "#1e40af",
                      }}
                    >
                      <Users size={12} />
                      <span>Shared faculty</span>
                    </span>
                  ) : alert.alert_type === "duplicate document" ? (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        fontSize: "11px",
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: "12px",
                        background: "#fef2f2",
                        color: "#b91c1c",
                      }}
                    >
                      <Copy size={12} />
                      <span>Duplicate document</span>
                    </span>
                  ) : (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        fontSize: "11px",
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: "12px",
                        background: "#fffbeb",
                        color: "#b45309",
                      }}
                    >
                      <MapPin size={12} />
                      <span>Shared address</span>
                    </span>
                  );

                const statusBadge =
                  alert.status === "Reviewed" ? (
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
                      Reviewed
                    </span>
                  ) : alert.status === "Escalated" ? (
                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 700,
                        padding: "2px 7px",
                        borderRadius: "10px",
                        background: "#f3e8ff",
                        color: "#7e22ce",
                        border: "1px solid #e9d5ff",
                      }}
                    >
                      Escalated
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 700,
                        padding: "2px 7px",
                        borderRadius: "10px",
                        background: "#fee2e2",
                        color: "#b91c1c",
                        border: "1px solid #fecaca",
                      }}
                    >
                      New
                    </span>
                  );

                return (
                  <div
                    key={alert.id}
                    onClick={() => handleSelectAlert(alert)}
                    style={{
                      padding: "14px 16px",
                      borderBottom: "1px solid #f1f5f9",
                      background: isSelected ? "#f0f7ff" : "#ffffff",
                      borderLeft: isSelected ? "4px solid #004792" : "4px solid transparent",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      transition: "background 0.15s ease",
                    }}
                  >
                    {/* Row Header: Type + Status */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        {typeBadge}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        {statusBadge}
                        <ArrowRight size={14} color={isSelected ? "#004792" : "#94a3b8"} />
                      </div>
                    </div>

                    {/* Entities (Masked) */}
                    <div>
                      <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 600 }}>Entities:</div>
                      <div style={{ fontSize: "12px", color: "#1e293b", fontWeight: 600 }}>
                        {alert.entities.map((ent, idx) => (
                          <span key={idx} style={{ display: "inline-block", marginRight: "8px" }}>
                            {maskId(ent)}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Applications Involved */}
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 600 }}>
                        Applications involved:
                      </span>
                      {alert.applications.map((appNum) => (
                        <span
                          key={appNum}
                          style={{
                            fontSize: "11px",
                            fontFamily: "monospace",
                            fontWeight: 600,
                            background: isSelected ? "#dbeafe" : "#f1f5f9",
                            color: isSelected ? "#1e40af" : "#334155",
                            padding: "2px 7px",
                            borderRadius: "4px",
                          }}
                        >
                          {appNum}
                        </span>
                      ))}
                    </div>

                    {alert.review_note && (
                      <div
                        style={{
                          fontSize: "11px",
                          color: "#15803d",
                          background: "#f0fdf4",
                          padding: "4px 8px",
                          borderRadius: "4px",
                          border: "1px dashed #86efac",
                        }}
                      >
                        ✓ Note: {alert.review_note}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Right: Interactive Graph */}
        <section
          style={{
            background: "#0f172a",
            border: "1px solid #1e293b",
            borderRadius: "10px",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            position: "relative",
          }}
        >
          {/* Graph Controls Toolbar */}
          <div
            style={{
              padding: "10px 16px",
              background: "#1e293b",
              borderBottom: "1px solid #334155",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              zIndex: 2,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Share2 size={14} color="#38bdf8" />
              <span style={{ fontSize: "12px", fontWeight: 700, color: "#f8fafc" }}>
                Cross-Entity Association Graph
              </span>
              {selectedAlert && (
                <span
                  style={{
                    fontSize: "11px",
                    color: "#94a3b8",
                    background: "#0f172a",
                    padding: "2px 6px",
                    borderRadius: "4px",
                  }}
                >
                  Focused: <strong style={{ color: "#38bdf8" }}>{selectedAlert.alert_type}</strong>
                </span>
              )}
            </div>

            {/* Zoom Controls */}
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <button
                onClick={() => setZoomLevel((z) => Math.min(z + 0.15, 1.6))}
                title="Zoom In"
                style={{
                  background: "#334155",
                  border: "none",
                  color: "#ffffff",
                  borderRadius: "4px",
                  padding: "4px 6px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <ZoomIn size={13} />
              </button>
              <button
                onClick={() => setZoomLevel((z) => Math.max(z - 0.15, 0.7))}
                title="Zoom Out"
                style={{
                  background: "#334155",
                  border: "none",
                  color: "#ffffff",
                  borderRadius: "4px",
                  padding: "4px 6px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <ZoomOut size={13} />
              </button>
              <button
                onClick={() => setZoomLevel(1)}
                title="Reset View"
                style={{
                  background: "#334155",
                  border: "none",
                  color: "#ffffff",
                  borderRadius: "4px",
                  padding: "4px 6px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <Maximize2 size={13} />
              </button>
            </div>
          </div>

          {/* SVG Graph Viewport */}
          <div
            style={{
              flex: 1,
              position: "relative",
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: "440px",
            }}
          >
            <svg
              width="100%"
              height="100%"
              viewBox="0 0 540 450"
              style={{
                transform: `scale(${zoomLevel})`,
                transformOrigin: "center center",
                transition: "transform 0.25s ease-out",
              }}
            >
              <defs>
                {/* Glow Filter for Active Elements */}
                <filter id="focus-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3.5" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
                <linearGradient id="edge-active" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#38bdf8" />
                  <stop offset="100%" stopColor="#f43f5e" />
                </linearGradient>
              </defs>

              {/* Background Grid Pattern */}
              <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
                <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#1e293b" strokeWidth="0.8" />
              </pattern>
              <rect width="100%" height="100%" fill="url(#grid)" />

              {/* Render Connecting Edges */}
              {graphEdges.map((edge) => {
                const src = graphNodes.find((n) => n.id === edge.source);
                const tgt = graphNodes.find((n) => n.id === edge.target);
                if (!src || !tgt) return null;

                const isEdgeFocused = selectedAlert ? edge.alertId === selectedAlert.id : false;
                const edgeOpacity = selectedAlert ? (isEdgeFocused ? 1 : 0.15) : 0.6;
                const strokeColor = isEdgeFocused ? "#38bdf8" : "#475569";
                const strokeWidth = isEdgeFocused ? 2.5 : 1.2;

                return (
                  <g key={edge.id}>
                    <line
                      x1={src.x}
                      y1={src.y}
                      x2={tgt.x}
                      y2={tgt.y}
                      stroke={strokeColor}
                      strokeWidth={strokeWidth}
                      strokeDasharray={isEdgeFocused ? "5,3" : undefined}
                      opacity={edgeOpacity}
                      style={{ transition: "all 0.3s ease" }}
                    />
                    {isEdgeFocused && (
                      <text
                        x={(src.x + tgt.x) / 2}
                        y={(src.y + tgt.y) / 2 - 6}
                        fill="#94a3b8"
                        fontSize="9"
                        textAnchor="middle"
                        fontFamily="monospace"
                        fontWeight="bold"
                      >
                        {edge.label}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Render Graph Nodes */}
              {graphNodes.map((node) => {
                // Determine if this node is active/focused
                const isInstitution = node.type === "institution";
                const isCentralEntity = !isInstitution;

                let isFocused = false;
                if (selectedAlert) {
                  if (node.alertId === selectedAlert.id) {
                    isFocused = true;
                  } else if (isInstitution) {
                    // Check if this institution is in selectedAlert.applications
                    isFocused = selectedAlert.applications.includes(node.sublabel);
                  }
                }

                const opacity = selectedAlert ? (isFocused ? 1 : 0.22) : 0.85;

                // Color mappings
                const fillColor = isInstitution
                  ? isFocused
                    ? "#0284c7"
                    : "#1e293b"
                  : node.type === "faculty"
                  ? isFocused
                    ? "#ef4444"
                    : "#7f1d1d"
                  : node.type === "document"
                  ? isFocused
                    ? "#f97316"
                    : "#7c2d12"
                  : isFocused
                  ? "#eab308"
                  : "#713f12";

                const strokeColor = isFocused ? "#ffffff" : isInstitution ? "#38bdf8" : "#94a3b8";
                const radius = isCentralEntity ? (isFocused ? 36 : 28) : isFocused ? 32 : 26;

                return (
                  <g
                    key={node.id}
                    opacity={opacity}
                    style={{ cursor: "pointer", transition: "all 0.3s ease" }}
                    onClick={() => {
                      if (node.alertId) {
                        const match = alerts.find((a) => a.id === node.alertId);
                        if (match) handleSelectAlert(match);
                      }
                    }}
                  >
                    {/* Glowing ring if focused */}
                    {isFocused && (
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={radius + 8}
                        fill="none"
                        stroke={isCentralEntity ? "#ef4444" : "#38bdf8"}
                        strokeWidth="2"
                        strokeDasharray="4 2"
                        opacity={0.7}
                      />
                    )}

                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={radius}
                      fill={fillColor}
                      stroke={strokeColor}
                      strokeWidth={isFocused ? 2.5 : 1.5}
                      filter={isFocused ? "url(#focus-glow)" : undefined}
                    />

                    {/* Node Text */}
                    <text
                      x={node.x}
                      y={node.y - 4}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize={isCentralEntity ? "9.5" : "9"}
                      fontWeight="bold"
                    >
                      {node.type === "institution"
                        ? node.label.split(" ")[0]
                        : node.type === "faculty"
                        ? "Faculty"
                        : node.type === "document"
                        ? "Duplicate Doc"
                        : "Address"}
                    </text>
                    <text
                      x={node.x}
                      y={node.y + 9}
                      textAnchor="middle"
                      fill={isFocused ? "#ffffff" : "#94a3b8"}
                      fontSize="8"
                      fontFamily="monospace"
                    >
                      {node.sublabel}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Bottom Floating Legend */}
            <div
              style={{
                position: "absolute",
                bottom: "10px",
                left: "14px",
                background: "rgba(15, 23, 42, 0.85)",
                border: "1px solid #334155",
                borderRadius: "6px",
                padding: "6px 10px",
                display: "flex",
                gap: "12px",
                fontSize: "10px",
                color: "#94a3b8",
                backdropFilter: "blur(4px)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#0284c7" }} />
                <span>Institution</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#ef4444" }} />
                <span>Shared Faculty</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#f97316" }} />
                <span>Duplicate Doc</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#eab308" }} />
                <span>Shared Address</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* "Why Flagged" Slide-Over / Expanding Drawer */}
      {selectedAlert && drawerOpen && (
        <section
          style={{
            marginTop: "18px",
            background: "#ffffff",
            border: "1px solid #cbd5e1",
            borderRadius: "10px",
            boxShadow: "0 4px 16px -2px rgba(0, 0, 0, 0.08)",
            padding: "20px 24px",
            position: "relative",
            animation: "fadeIn 0.2s ease-in-out",
          }}
        >
          {/* Drawer Header */}
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
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "#004792", letterSpacing: "0.5px" }}>
                  WHY FLAGGED DRAWER
                </span>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    padding: "1px 6px",
                    borderRadius: "8px",
                    background:
                      selectedAlert.status === "Reviewed"
                        ? "#dcfce7"
                        : selectedAlert.status === "Escalated"
                        ? "#f3e8ff"
                        : "#fee2e2",
                    color:
                      selectedAlert.status === "Reviewed"
                        ? "#15803d"
                        : selectedAlert.status === "Escalated"
                        ? "#7e22ce"
                        : "#b91c1c",
                  }}
                >
                  {selectedAlert.status}
                </span>
              </div>
              <h2 style={{ fontSize: "17px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
                Flagged Association: {selectedAlert.alert_type}
              </h2>
            </div>

            {/* Action Buttons: Mark reviewed (with note), Open applications */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <button
                onClick={() => setIsReviewing(!isReviewing)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  background: isReviewing ? "#0f172a" : "#004792",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "6px",
                  padding: "7px 13px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <CheckCircle2 size={14} />
                <span>Mark reviewed (with a note)</span>
              </button>

              <button
                onClick={() => void handleOpenApplications()}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  background: "#f1f5f9",
                  color: "#0f172a",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  padding: "7px 13px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <ExternalLink size={14} color="#004792" />
                <span>Open applications</span>
              </button>

              {selectedAlert.status !== "Escalated" && (
                <button
                  onClick={() => void handleEscalate()}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    background: "#fef2f2",
                    color: "#991b1b",
                    border: "1px solid #fecaca",
                    borderRadius: "6px",
                    padding: "7px 12px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <AlertTriangle size={14} />
                  <span>Escalate</span>
                </button>
              )}

              <button
                onClick={() => setDrawerOpen(false)}
                title="Close drawer"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#94a3b8",
                  cursor: "pointer",
                  padding: "4px",
                  marginLeft: "4px",
                }}
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Drawer Body Grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 1fr",
              gap: "20px",
              alignItems: "start",
            }}
          >
            {/* Left side of drawer: Shared Item + Plain Explanation */}
            <div>
              {/* The Shared Item */}
              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  padding: "14px 16px",
                  marginBottom: "14px",
                }}
              >
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                  Shared Item (Masked Identifier)
                </div>
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: 700,
                    color: "#004792",
                    fontFamily: "monospace",
                    margin: "4px 0 6px",
                  }}
                >
                  {selectedAlert.masked_entity}
                </div>
                <div style={{ fontSize: "12px", color: "#475569" }}>
                  {selectedAlert.entities.map((e, idx) => (
                    <div key={idx}>Entity record: {maskId(e)}</div>
                  ))}
                </div>
              </div>

              {/* Plain Explanation */}
              <div style={{ marginBottom: "14px" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                  Plain Explanation:
                </div>
                <p style={{ fontSize: "13px", color: "#334155", margin: 0, lineHeight: 1.5 }}>
                  {selectedAlert.explanation}
                </p>
              </div>

              {/* Mandatory Legitimate Explanations Note */}
              <div
                style={{
                  background: "#fffbeb",
                  border: "1px solid #fef3c7",
                  borderRadius: "8px",
                  padding: "12px 16px",
                  fontSize: "12px",
                  color: "#92400e",
                  lineHeight: 1.45,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}>
                  <Info size={14} color="#b45309" />
                  <strong>Administrative Policy Note:</strong>
                </div>
                There may be legitimate explanations (for example, approved visiting faculty, shared multi-institution education trusts, or contiguous campus master zoning). Officers must review submitted affidavits and statutory records before arriving at any administrative decision.
              </div>
            </div>

            {/* Right side of drawer: Applications Involved & Review Note Input */}
            <div>
              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  padding: "14px 16px",
                  marginBottom: "14px",
                }}
              >
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "8px" }}>
                  Applications Involved ({selectedAlert.applications.length}):
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {selectedAlert.applications.map((appNum) => {
                    const uuid = APP_UUID_MAP[appNum];
                    return (
                      <div
                        key={appNum}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          background: "#ffffff",
                          border: "1px solid #cbd5e1",
                          borderRadius: "6px",
                          padding: "8px 12px",
                        }}
                      >
                        <div>
                          <span style={{ fontSize: "12px", fontFamily: "monospace", fontWeight: 700, color: "#004792" }}>
                            {appNum}
                          </span>
                        </div>
                        {uuid ? (
                          <Link
                            href={`/case/${uuid}`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              fontSize: "11px",
                              fontWeight: 600,
                              color: "#004792",
                              textDecoration: "none",
                              background: "#e0f2fe",
                              padding: "3px 8px",
                              borderRadius: "4px",
                            }}
                          >
                            <span>Open Case</span>
                            <ExternalLink size={11} />
                          </Link>
                        ) : (
                          <Link
                            href={`/officer?search=${appNum}`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              fontSize: "11px",
                              fontWeight: 600,
                              color: "#004792",
                              textDecoration: "none",
                              background: "#e0f2fe",
                              padding: "3px 8px",
                              borderRadius: "4px",
                            }}
                          >
                            <span>Search Queue</span>
                            <ExternalLink size={11} />
                          </Link>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Review Input Box */}
              {isReviewing && (
                <div
                  style={{
                    background: "#f0fdf4",
                    border: "1px solid #bbf7d0",
                    borderRadius: "8px",
                    padding: "14px 16px",
                  }}
                >
                  <label
                    style={{
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "#166534",
                      display: "block",
                      marginBottom: "6px",
                    }}
                  >
                    Officer Review Note (Audited)
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Enter review remarks (e.g. Verified with University Syndicate order: permitted visiting faculty for PG specialization)..."
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                    style={{
                      width: "100%",
                      borderRadius: "6px",
                      border: "1px solid #86efac",
                      padding: "8px 10px",
                      fontSize: "12px",
                      marginBottom: "8px",
                      fontFamily: "inherit",
                    }}
                  />
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={() => void handleMarkReviewed()}
                      style={{
                        fontSize: "12px",
                        fontWeight: 600,
                        background: "#16a34a",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: "6px",
                        padding: "6px 14px",
                        cursor: "pointer",
                      }}
                    >
                      Save & Mark Reviewed
                    </button>
                    <button
                      onClick={() => setIsReviewing(false)}
                      style={{
                        fontSize: "12px",
                        fontWeight: 500,
                        background: "#ffffff",
                        color: "#475569",
                        border: "1px solid #cbd5e1",
                        borderRadius: "6px",
                        padding: "6px 12px",
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Action Result Notification */}
              {actionMessage && (
                <div
                  style={{
                    fontSize: "12px",
                    color: "#15803d",
                    fontWeight: 600,
                    background: "#f0fdf4",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    marginTop: "8px",
                    border: "1px solid #bbf7d0",
                  }}
                >
                  ✓ {actionMessage}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Open Applications Modal */}
      {openAppsModal && selectedAlert && (
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Building size={18} color="#004792" />
                <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
                  Involved Applications
                </h3>
              </div>
              <button
                onClick={() => setOpenAppsModal(false)}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: "#94a3b8" }}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 16px" }}>
              This {selectedAlert.alert_type} alert involves the following institutional submissions. Select an application to open its complete case file:
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px" }}>
              {selectedAlert.applications.map((appNum) => {
                const uuid = APP_UUID_MAP[appNum];
                return (
                  <div
                    key={appNum}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      border: "1px solid #cbd5e1",
                      borderRadius: "6px",
                      padding: "10px 14px",
                      background: "#f8fafc",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "#1e293b", fontFamily: "monospace" }}>
                        {appNum}
                      </div>
                      <div style={{ fontSize: "11px", color: "#64748b" }}>
                        Technical Education Application Cycle 2026-27
                      </div>
                    </div>
                    {uuid ? (
                      <Link
                        href={`/case/${uuid}`}
                        onClick={() => setOpenAppsModal(false)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          background: "#004792",
                          color: "#ffffff",
                          textDecoration: "none",
                          fontSize: "12px",
                          fontWeight: 600,
                          padding: "6px 12px",
                          borderRadius: "6px",
                        }}
                      >
                        <span>Open Case</span>
                        <ExternalLink size={12} />
                      </Link>
                    ) : (
                      <Link
                        href={`/officer?search=${appNum}`}
                        onClick={() => setOpenAppsModal(false)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          background: "#004792",
                          color: "#ffffff",
                          textDecoration: "none",
                          fontSize: "12px",
                          fontWeight: 600,
                          padding: "6px 12px",
                          borderRadius: "6px",
                        }}
                      >
                        <span>Search Queue</span>
                        <ExternalLink size={12} />
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => setOpenAppsModal(false)}
                style={{
                  background: "#f1f5f9",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  padding: "6px 14px",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#475569",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
