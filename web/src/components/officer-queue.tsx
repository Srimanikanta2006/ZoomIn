"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import {
  Search,
  Filter,
  ChevronRight,
  Clock,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  User,
  Layers,
} from "lucide-react";
import type { ApplicationRow } from "./review-workspace";
import type { Finding, RuleData } from "@/lib/models";

interface OfficerQueueProps {
  apps: ApplicationRow[];
  findings: Finding[];
  lanes?: RuleData["officer_lanes"];
  currentUserId: string;
  timelines?: RuleData["officer_timelines"];
  loading: boolean;
}

export function OfficerQueue({ apps, findings, lanes, currentUserId, timelines, loading }: OfficerQueueProps) {
  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [laneFilter, setLaneFilter] = useState("all");
  const [regionFilter, setRegionFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [assignedToMeOnly, setAssignedToMeOnly] = useState(false);
  const deadlineDays = timelines?.review_deadline_days ?? 14;
  const approachingDays = timelines?.approaching_deadline_days ?? 3;
  const ageingWarningDays = timelines?.ageing_warning_days ?? 6;

  // Classify each application into one of the 3 triage lanes
  const classifyApp = (app: ApplicationRow): "clean" | "clarification" | "investigation" => {
    const activeStatuses = new Set([
      ...(lanes?.clarification?.statuses ?? ["open", "under_review"]),
      ...(lanes?.investigation?.statuses ?? ["open", "under_review"]),
    ]);
    const active = findings.filter(
      (finding) =>
        finding.application_id === app.id &&
        activeStatuses.has(finding.status)
    );
    const investigationSeverities = lanes?.investigation?.severities ?? ["critical", "high"];
    if (active.some((finding) => investigationSeverities.includes(finding.severity))) {
      return "investigation";
    }
    const clarificationSeverities = lanes?.clarification?.severities ?? ["info", "low", "medium"];
    if (active.some((finding) => clarificationSeverities.includes(finding.severity)) || active.length > 0) {
      return "clarification";
    }
    return "clean";
  };

  // Filtered applications list
  const filteredApps = useMemo(() => {
    return apps.filter((app) => {
      const instName = (app.institutions?.name || "").toLowerCase();
      const instCode = (app.institutions?.institution_code || "").toLowerCase();
      const appNum = app.application_number.toLowerCase();
      const q = searchQuery.toLowerCase().trim();

      // Search match (institution, AICTE ID, application ID)
      if (q && !instName.includes(q) && !instCode.includes(q) && !appNum.includes(q)) {
        return false;
      }

      // Status filter
      if (statusFilter !== "all" && app.status !== statusFilter) {
        return false;
      }

      // Lane filter
      const lane = classifyApp(app);
      if (laneFilter !== "all" && lane !== laneFilter) {
        return false;
      }

      // Region / State filter
      const state = app.institutions?.state || "";
      if (regionFilter !== "all" && state !== regionFilter) {
        return false;
      }

      // Date range filter
      if (dateFilter !== "all") {
        const createdDate = new Date(app.created_at || app.updated_at).getTime();
        const days = Number.isFinite(createdDate) ? Math.max(0, Math.floor((Date.now() - createdDate) / 86400000)) : 0;
        if (dateFilter === "7d" && days > 7) return false;
        if (dateFilter === "14d" && days > 14) return false;
        if (dateFilter === "30d" && days > 30) return false;
        if (dateFilter === "30d_plus" && days <= 30) return false;
      }

      // Assigned to me filter
      if (assignedToMeOnly) {
        if (!currentUserId || app.assigned_officer !== currentUserId) return false;
      }

      return true;
    });
  }, [apps, searchQuery, statusFilter, laneFilter, regionFilter, dateFilter, assignedToMeOnly, currentUserId, findings, lanes]);

  // Three Triage Lanes definition
  const LANE_DEFINITIONS = [
    {
      id: "clean" as const,
      title: "Clean",
      desc: "Applications with zero open severity indicators.",
      color: "#059669",
      bg: "#ecfdf5",
    },
    {
      id: "clarification" as const,
      title: "Needs Clarification",
      desc: "Minor discrepancies requiring documentary response.",
      color: "#d97706",
      bg: "#fffbeb",
    },
    {
      id: "investigation" as const,
      title: "Needs Investigation",
      desc: "High-priority indicators, expired NOCs, or cross-institution overlaps.",
      color: "#dc2626",
      bg: "#fef2f2",
    },
  ];

  return (
    <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "16px 20px" }} aria-busy={loading}>
      {/* Page Header (Clean, NO demo buttons) */}
      <div style={{ marginBottom: "20px" }}>
        <span style={{ fontSize: "11px", fontWeight: 700, color: "#004792", letterSpacing: "0.5px" }}>
          OFFICER WORKSPACE
        </span>
        <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#1a2530", margin: "2px 0 0" }}>
          Triage Queue
        </h1>
        <p style={{ fontSize: "13px", color: "#64748b", margin: "4px 0 0" }}>
          Review submitted applications triaged by automated risk lanes. Humans make all final determinations.
        </p>
      </div>

      {loading ? (
        <p role="status" style={{ color: "#64748b", fontSize: "13px" }}>Loading applications…</p>
      ) : apps.length === 0 ? (
        <p role="status" style={{ color: "#64748b", fontSize: "13px" }}>No applications yet.</p>
      ) : null}

      {/* Search and Filters Toolbar */}
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #dcdad4",
          borderRadius: "8px",
          padding: "14px 18px",
          marginBottom: "20px",
          display: "flex",
          flexWrap: "wrap",
          gap: "12px",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {/* Search Bar */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: "260px" }}>
          <Search size={16} color="#64748b" />
          <input
            type="text"
            placeholder="Search institution, AICTE ID, or Application number…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              border: "1px solid #cbd5e1",
              borderRadius: "6px",
              padding: "6px 12px",
              fontSize: "12px",
            }}
          />
        </div>

        {/* Filters Group */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              fontSize: "12px",
              padding: "6px 10px",
              borderRadius: "6px",
              border: "1px solid #cbd5e1",
              background: "#ffffff",
            }}
          >
            <option value="all">All Statuses</option>
            <option value="submitted">Submitted</option>
            <option value="under_review">In Review</option>
            <option value="returned_for_clarification">Awaiting institution</option>
            <option value="completed">Completed</option>
          </select>

          {/* Lane Filter */}
          <select
            value={laneFilter}
            onChange={(e) => setLaneFilter(e.target.value)}
            style={{
              fontSize: "12px",
              padding: "6px 10px",
              borderRadius: "6px",
              border: "1px solid #cbd5e1",
              background: "#ffffff",
            }}
          >
            <option value="all">All Lanes</option>
            <option value="clean">Clean</option>
            <option value="clarification">Needs Clarification</option>
            <option value="investigation">Needs Investigation</option>
          </select>

          {/* Region Filter */}
          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            style={{
              fontSize: "12px",
              padding: "6px 10px",
              borderRadius: "6px",
              border: "1px solid #cbd5e1",
              background: "#ffffff",
            }}
          >
            <option value="all">All Regions</option>
            <option value="Karnataka">Karnataka</option>
            <option value="Maharashtra">Maharashtra</option>
            <option value="Tamil Nadu">Tamil Nadu</option>
            <option value="Gujarat">Gujarat</option>
            <option value="Kerala">Kerala</option>
          </select>

          {/* Date Range Filter */}
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            style={{
              fontSize: "12px",
              padding: "6px 10px",
              borderRadius: "6px",
              border: "1px solid #cbd5e1",
              background: "#ffffff",
            }}
          >
            <option value="all">All Dates</option>
            <option value="7d">Last 7 Days</option>
            <option value="14d">Last 14 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="30d_plus">Over 30 Days</option>
          </select>

          <span style={{ fontSize: "11px", color: "#64748b" }}>
            Review deadline: {deadlineDays} days
          </span>

          {/* Assigned To Me Checkbox */}
          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#334155", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={assignedToMeOnly}
              onChange={(e) => setAssignedToMeOnly(e.target.checked)}
            />
            <span>Assigned to me</span>
          </label>
        </div>
      </div>

      {/* 3 Triage Lanes Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "16px",
          alignItems: "start",
        }}
      >
        {LANE_DEFINITIONS.map((laneDef) => {
          const laneApps = filteredApps.filter((a) => classifyApp(a) === laneDef.id);

          return (
            <section
              key={laneDef.id}
              style={{
                background: "#ffffff",
                border: "1px solid #dcdad4",
                borderRadius: "10px",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                minHeight: "450px",
              }}
            >
              {/* Lane Header */}
              <div
                style={{
                  padding: "14px 16px",
                  background: laneDef.bg,
                  borderBottom: `2px solid ${laneDef.color}`,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        background: laneDef.color,
                      }}
                    />
                    <h2 style={{ fontSize: "14px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
                      {laneDef.title}
                    </h2>
                  </div>
                  <p style={{ fontSize: "11px", color: "#64748b", margin: "2px 0 0" }}>{laneDef.desc}</p>
                </div>

                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 800,
                    color: laneDef.color,
                    background: "#ffffff",
                    padding: "2px 8px",
                    borderRadius: "12px",
                    border: `1px solid ${laneDef.color}40`,
                  }}
                >
                  {laneApps.length}
                </span>
              </div>

              {/* Lane Cards List */}
              <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "10px", flex: 1 }}>
                {laneApps.length === 0 ? (
                  <div
                    style={{
                      padding: "32px 16px",
                      textAlign: "center",
                      color: "#94a3b8",
                      fontSize: "12px",
                    }}
                  >
                    No applications in this lane.
                  </div>
                ) : (
                  laneApps.map((app) => {
                    const appFindings = findings.filter(
                      (f) => f.application_id === app.id && (f.status === "open" || f.status === "under_review")
                    );
                    const topIssue =
                      appFindings.slice().sort((a, b) => {
                        const prio = ["critical", "high", "medium", "low", "info"];
                        return prio.indexOf(a.severity) - prio.indexOf(b.severity);
                      })[0]?.reason || "No open findings";

                    // Calculate days pending & ageing
                    const createdDate = new Date(app.created_at || app.updated_at).getTime();
                    const daysPending = Number.isFinite(createdDate)
                      ? Math.max(0, Math.floor((Date.now() - createdDate) / 86400000))
                      : 0;

                    // Ageing color indicator
                    const ageingColor = daysPending >= deadlineDays ? "#dc2626" : daysPending >= ageingWarningDays ? "#d97706" : "#059669";
                    const isApproachingDeadline = daysPending >= Math.max(0, deadlineDays - approachingDays);

                    const instName = app.institutions?.name || "Institution record unavailable";
                    const instCode = app.institutions?.institution_code || "Institution ID unavailable";
                    const assignedOfficer = !app.assigned_officer
                      ? "Unassigned"
                      : app.assigned_officer === currentUserId
                        ? "You"
                        : `Officer ${app.assigned_officer.slice(0, 8)}`;

                    return (
                      <article
                        key={app.id}
                        style={{
                          border: "1px solid #e2e8f0",
                          borderRadius: "8px",
                          padding: "12px 14px",
                          background: "#ffffff",
                          display: "flex",
                          flexDirection: "column",
                          gap: "8px",
                          transition: "box-shadow 0.2s ease",
                        }}
                      >
                        {/* Card Top: Institution & Approaching Deadline Badge */}
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "6px" }}>
                            <strong style={{ fontSize: "13px", color: "#1e293b", lineHeight: 1.3 }}>
                              {instName}
                            </strong>
                            {isApproachingDeadline && (
                              <span
                                style={{
                                  fontSize: "10px",
                                  fontWeight: 700,
                                  color: "#92400e",
                                  background: "#fef3c7",
                                  border: "1px solid #fde68a",
                                  padding: "2px 6px",
                                  borderRadius: "4px",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                ⏱ Approaching deadline
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                            {instCode} · {app.application_number}
                          </div>
                        </div>

                        {/* Metadata row: Type, Days pending, Findings count */}
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            fontSize: "11px",
                            color: "#475569",
                            background: "#f8fafc",
                            padding: "6px 8px",
                            borderRadius: "4px",
                          }}
                        >
                          <span>Type: {app.application_type.replaceAll("_", " ")}</span>
                          <span style={{ display: "flex", alignItems: "center", gap: "4px", color: ageingColor, fontWeight: 700 }}>
                            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: ageingColor }} />
                            {daysPending}d pending
                          </span>
                        </div>

                        {/* Assigned Officer & Findings Count */}
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#64748b" }}>
                          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                            <User size={12} /> {assignedOfficer}
                          </span>
                          <span style={{ fontWeight: 600, color: appFindings.length > 0 ? "#dc2626" : "#059669" }}>
                            {appFindings.length} {appFindings.length === 1 ? "indicator" : "indicators"}
                          </span>
                        </div>

                        {/* ONE Top-Issue Line */}
                        <div
                          style={{
                            fontSize: "11px",
                            color: appFindings.length > 0 ? "#78350f" : "#166534",
                            background: appFindings.length > 0 ? "#fffbeb" : "#f0fdf4",
                            padding: "6px 8px",
                            borderRadius: "4px",
                            lineHeight: 1.35,
                          }}
                        >
                          <strong>Top issue:</strong> {topIssue}
                        </div>

                        {/* Link to Case File */}
                        <div style={{ marginTop: "2px", textAlign: "right" }}>
                          <Link
                            href={`/case/${app.id}`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              fontSize: "12px",
                              fontWeight: 600,
                              color: "#004792",
                              textDecoration: "none",
                            }}
                          >
                            <span>Inspect case</span>
                            <ChevronRight size={13} />
                          </Link>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
