"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";
import { BarChart3, ClipboardList, BookOpen, Mail, Building2, LogOut, SlidersHorizontal, RotateCcw, X, AlertCircle, Fingerprint, Search } from "lucide-react";
import { ROLE_LABELS, type Role } from "@/lib/roles";
import { getSupabase } from "@/lib/supabase";
import { NotificationBell } from "@/components/notification-bell";

export type OfficerPage = "queue" | "case_file" | "trust_graph" | "rules" | "metrics" | "audit" | "timeline" | "letters" | "portal" | "notices";

interface NavItem {
  id: string;
  label: string;
  sub: string;
  href: string;
  icon: typeof ClipboardList;
}

export function OfficerShell({
  page, email, role, children, onResetDemo, onToggleIssuerOutage, issuerOutage = false, demoBusy = false,
}: {
  page: OfficerPage;
  email: string;
  role: Role | null;
  caseHref?: string;
  children: React.ReactNode;
  onResetDemo?: () => Promise<void>;
  onToggleIssuerOutage?: () => Promise<void>;
  issuerOutage?: boolean;
  demoBusy?: boolean;
}) {
  const supabase = getSupabase();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

  // Navigation strictly scoped by role
  const getNavLinks = useCallback((): NavItem[] => {
    if (role === "applicant") {
      return [
        { id: "portal", label: "My Applications", sub: "View submission status", href: "/portal", icon: Building2 },
      ];
    }
    if (role === "scrutiny_officer" || role === "regional_officer") {
      return [
        { id: "queue", label: "Queue", sub: "Application triage", href: "/officer", icon: ClipboardList },
        { id: "trust_graph", label: "Trust Alerts", sub: "Collision network", href: "/graph", icon: Fingerprint },
        { id: "notices", label: "Notices", sub: "Deficiency letters", href: "/letters", icon: Mail },
      ];
    }
    if (role === "admin") {
      return [
        { id: "rules", label: "Rules", sub: "AICTE handbook", href: "/rules", icon: BookOpen },
        { id: "metrics", label: "Metrics", sub: "Benchmark & agreement", href: "/metrics", icon: BarChart3 },
        { id: "audit", label: "Audit", sub: "Hash-chained ledger", href: "/audit", icon: BarChart3 },
      ];
    }
    return [
      { id: "portal", label: "My Applications", sub: "View submission status", href: "/portal", icon: Building2 },
    ];
  }, [role]);

  const navLinks = getNavLinks();
  const pageRoles: Record<OfficerPage, Role[]> = {
    queue: ["scrutiny_officer", "regional_officer"],
    case_file: ["scrutiny_officer", "regional_officer"],
    trust_graph: ["scrutiny_officer", "regional_officer"],
    rules: ["admin"],
    metrics: ["admin"],
    audit: ["admin"],
    timeline: ["scrutiny_officer", "regional_officer"],
    letters: ["scrutiny_officer", "regional_officer"],
    portal: ["applicant"],
    notices: ["scrutiny_officer", "regional_officer"],
  };
  const canOpenPage = role !== null && pageRoles[page].includes(role);

  const handleSignOut = useCallback(async (isTimeout = false) => {
    if (typeof window !== "undefined") {
      if (isTimeout) {
        sessionStorage.setItem("zoomin_timeout", "Your session timed out due to inactivity. Please sign in again.");
      }
    }
    if (supabase) {
      await supabase.auth.signOut().catch(() => {});
    }
    window.location.href = "/";
  }, [supabase]);

  // Session timeout: 15 minutes of user inactivity
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const resetTimer = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      void handleSignOut(true);
    }, 15 * 60 * 1000);
  }, [handleSignOut]);

  useEffect(() => {
    const events = ["mousedown", "mousemove", "keydown", "scroll", "touchstart"];
    events.forEach((evt) => window.addEventListener(evt, resetTimer, { passive: true }));
    resetTimer();
    return () => {
      events.forEach((evt) => window.removeEventListener(evt, resetTimer));
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [resetTimer]);

  const homeHref = role === "applicant" ? "/portal" : role === "admin" ? "/rules" : "/officer";

  return (
    <div className="review-app">
      {/* Feather Atlas Styled Sidebar with ZoomIn Branding */}
      <aside className="review-nav">
        <Link className="review-logo" href={homeHref} aria-label="ZoomIn home">
          <span className="brand-lens" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <circle cx="11" cy="11" r="3" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.7" />
            </svg>
          </span>
          <b>
            ZoomIn
            <small>AICTE REVIEW</small>
          </b>
        </Link>

        <nav aria-label="Role-scoped workspace navigation" className="sidebar-nav-list">
          {navLinks.map(({ id, label, sub, href, icon: Icon }) => {
            const isActive = page === id || (id === "queue" && page === "case_file") || (id === "notices" && page === "letters");
            return (
              <Link
                key={id}
                className={isActive ? "review-nav-link active" : "review-nav-link"}
                href={href}
                aria-current={isActive ? "page" : undefined}
              >
                <span className="nav-icon-wrap">
                  <Icon size={16} />
                </span>
                <div className="nav-label-group">
                  <span className="nav-primary-label">{label}</span>
                  <small className="nav-sub-label">{sub}</small>
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Featured Card Pinned to Bottom */}
        <div className="sidebar-featured-card">
          <div className="featured-eyebrow">ZOOMIN AICTE ENGINE</div>
          <h4 className="featured-title">Evidence Scrutiny</h4>
          <p className="featured-desc">Cryptographic ledger verification & cross-source indicator detection.</p>
          <div className="featured-status-row">
            <span className="featured-dot" />
            <span>Human-in-the-loop active</span>
          </div>
        </div>

        <div className="sidebar-signout-row">
          <button
            onClick={() => void handleSignOut(false)}
            className="sidebar-signout-btn"
          >
            <LogOut size={14} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      <header className="review-header">
        <div className="review-breadcrumb">
          <Search size={14} className="breadcrumb-search-icon" />
          <span>ZOOMIN</span>
          <span className="breadcrumb-sep">/</span>
          <span className="breadcrumb-current">
            {navLinks.find((item) => item.id === page)?.label.toUpperCase() ?? page.toUpperCase()}
          </span>
        </div>

        <div className="review-header-tools">
          <NotificationBell role={role} />

          {/* Admin-only Demo Controls Drawer Trigger */}
          {isDemoMode && role === "admin" && (
            <button
              onClick={() => setDrawerOpen(true)}
              className="admin-demo-trigger"
              title="Open Admin Demo Controls"
            >
              <SlidersHorizontal size={13} />
              <span>Demo controls</span>
            </button>
          )}

          {/* User Identity Chip */}
          <div className="review-user">
            <span className="review-user-email">{email || "User"}</span>
            <b className="review-user-role">{role ? ROLE_LABELS[role] : "Role not assigned"}</b>
          </div>

          <button
            onClick={() => void handleSignOut(false)}
            className="topbar-signout-btn"
            title="Sign out"
          >
            <LogOut size={13} />
            <span>Sign out</span>
          </button>
        </div>
      </header>

      <main className="review-main">
        {canOpenPage ? children : (
          <section className="review-empty">
            <h1>{role ? "This workspace is not available to your role." : "Sign in to continue."}</h1>
            <p>{role ? "Use the navigation for your assigned workspace." : "Your account role is checked after sign-in."}</p>
            {!role && <Link href="/">Go to sign in</Link>}
          </section>
        )}
        <footer className="review-footer-note">Indicators for human review, not decisions.</footer>
      </main>

      {/* Admin-only Demo Controls Drawer */}
      {isDemoMode && role === "admin" && drawerOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            zIndex: 9999,
            display: "flex",
            justifyContent: "flex-end",
          }}
          onClick={() => setDrawerOpen(false)}
        >
          <aside
            style={{
              width: "320px",
              background: "#ffffff",
              height: "100%",
              boxShadow: "-4px 0 24px rgba(0,0,0,0.15)",
              padding: "24px 20px",
              display: "flex",
              flexDirection: "column",
              gap: "20px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #eee", paddingBottom: "12px" }}>
              <div>
                <p style={{ margin: 0, fontSize: "11px", fontWeight: 700, color: "#8b6200", letterSpacing: "0.05em" }}>ADMIN CONSOLE</p>
                <h2 style={{ margin: "2px 0 0", fontSize: "16px", fontWeight: 700, color: "#1a2530" }}>Demo Controls</h2>
              </div>
              <button onClick={() => setDrawerOpen(false)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#666" }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ background: "#f8f9fa", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "14px" }}>
                <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={issuerOutage}
                    onChange={() => void onToggleIssuerOutage?.()}
                    disabled={demoBusy}
                    style={{ marginTop: "3px" }}
                  />
                  <div>
                    <span style={{ fontSize: "13px", fontWeight: 600, color: "#1a2530", display: "block" }}>Simulate issuer outage</span>
                    <small style={{ fontSize: "11px", color: "#64748b", display: "block", marginTop: "2px" }}>
                      Causes third-party registries to fail; activates degraded local fallback.
                    </small>
                  </div>
                </label>
              </div>

              <div style={{ background: "#f8f9fa", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "14px" }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#1a2530", display: "block", marginBottom: "4px" }}>Reset demo data</span>
                <small style={{ fontSize: "11px", color: "#64748b", display: "block", marginBottom: "12px" }}>
                  Clears all human review findings, resets issuer simulation, and restores baseline synthetic data.
                </small>
                <button
                  onClick={() => void onResetDemo?.()}
                  disabled={demoBusy}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    background: "#032448",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "6px",
                    padding: "8px 12px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <RotateCcw size={13} />
                  <span>{demoBusy ? "Resetting…" : "Reset demo state"}</span>
                </button>
              </div>
            </div>

            <div style={{ marginTop: "auto", fontSize: "11px", color: "#718096", borderTop: "1px solid #eee", paddingTop: "12px" }}>
              <AlertCircle size={13} style={{ display: "inline", verticalAlign: "middle", marginRight: "4px" }} />
              Demo controls are only available in DEMO_MODE for admin accounts.
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
