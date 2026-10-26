"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  BarChart3,
  ClipboardList,
  BookOpen,
  Mail,
  Building2,
  LogOut,
  SlidersHorizontal,
  RotateCcw,
  X,
  AlertCircle,
  Fingerprint,
  Search,
  Clock,
  ShieldCheck,
  UserCheck,
  Briefcase,
  Layers,
} from "lucide-react";
import { ROLE_LABELS, type Role } from "@/lib/roles";
import { getSupabase } from "@/lib/supabase";
import { NotificationBell } from "@/components/notification-bell";

export type OfficerPage =
  | "queue"
  | "case_file"
  | "trust_graph"
  | "rules"
  | "metrics"
  | "audit"
  | "timeline"
  | "letters"
  | "portal"
  | "notices";

interface NavItem {
  id: OfficerPage;
  label: string;
  sub: string;
  href: string;
  icon: typeof ClipboardList;
  section: "Scrutiny" | "Administration" | "Institution";
}

const ALL_NAV_ITEMS: NavItem[] = [
  // Scrutiny
  { id: "queue", label: "Triage Queue", sub: "Application scrutiny", href: "/officer", icon: ClipboardList, section: "Scrutiny" },
  { id: "trust_graph", label: "Trust Alerts", sub: "Collision network", href: "/graph", icon: Fingerprint, section: "Scrutiny" },
  { id: "timeline", label: "Validity Timeline", sub: "Document countdown", href: "/timeline", icon: Clock, section: "Scrutiny" },
  { id: "notices", label: "Deficiency Notices", sub: "Notice generator", href: "/letters", icon: Mail, section: "Scrutiny" },

  // Administration
  { id: "rules", label: "Rules Studio", sub: "AICTE handbook", href: "/rules", icon: BookOpen, section: "Administration" },
  { id: "metrics", label: "Model Metrics", sub: "Benchmark accuracy", href: "/metrics", icon: BarChart3, section: "Administration" },
  { id: "audit", label: "Audit Ledger", sub: "Tamper-proof log", href: "/audit", icon: ShieldCheck, section: "Administration" },

  // Institution
  { id: "portal", label: "Institution Portal", sub: "Applicant view", href: "/portal", icon: Building2, section: "Institution" },
];

export function OfficerShell({
  page,
  email,
  role: initialRole,
  children,
  onResetDemo,
  onToggleIssuerOutage,
  issuerOutage = false,
  demoBusy = false,
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
  const router = useRouter();
  const supabase = getSupabase();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

  // Active role strictly synced with sessionStorage or initialRole
  const [activeRole, setActiveRole] = useState<Role>(() => {
    if (typeof window !== "undefined") {
      const stored = sessionStorage.getItem("zoomin_demo_role") as Role | null;
      if (stored) return stored;
    }
    if (initialRole) return initialRole;
    if (page === "portal") return "applicant";
    if (page === "rules" || page === "metrics" || page === "audit") return "admin";
    return "scrutiny_officer";
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = sessionStorage.getItem("zoomin_demo_role") as Role | null;
      if (stored) {
        setActiveRole(stored);
        return;
      }
    }
    if (initialRole) {
      setActiveRole(initialRole);
    } else {
      if (page === "portal") setActiveRole("applicant");
      else if (page === "rules" || page === "metrics" || page === "audit") setActiveRole("admin");
      else setActiveRole("scrutiny_officer");
    }
  }, [initialRole, page]);

  // Strict page guard: ensure logged-in profile only accesses their allowed views
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = (sessionStorage.getItem("zoomin_demo_role") as Role | null) || initialRole || activeRole;
      if (stored === "admin") {
        const isAdminPage = page === "rules" || page === "metrics" || page === "audit";
        if (!isAdminPage) router.replace("/rules");
      } else if (stored === "applicant") {
        if (page !== "portal") router.replace("/portal");
      } else if (stored === "scrutiny_officer") {
        const isOfficerPage = page === "queue" || page === "case_file" || page === "trust_graph" || page === "timeline" || page === "letters" || page === "notices";
        if (!isOfficerPage) router.replace("/officer");
      }
    }
  }, [activeRole, initialRole, page, router]);

  // Navigation items strictly scoped to active logged-in role
  const roleNavItems = useMemo(() => {
    if (activeRole === "admin") {
      return ALL_NAV_ITEMS.filter((item) => item.section === "Administration");
    }
    if (activeRole === "applicant") {
      return ALL_NAV_ITEMS.filter((item) => item.section === "Institution");
    }
    return ALL_NAV_ITEMS.filter((item) => item.section === "Scrutiny");
  }, [activeRole]);

  const sectionHeading =
    activeRole === "admin"
      ? "Administration"
      : activeRole === "applicant"
      ? "Institution Filings"
      : "Regulatory Scrutiny";

  const handleSignOut = useCallback(async (isTimeout = false) => {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("zoomin_demo_user");
      sessionStorage.removeItem("zoomin_demo_role");
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

  const homeHref = activeRole === "applicant" ? "/portal" : activeRole === "admin" ? "/rules" : "/officer";

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

        {/* Role-scoped Navigation List - Strictly shows only logged-in profile items */}
        <nav aria-label="Role-scoped workspace navigation" className="sidebar-nav-list" style={{ overflowY: "auto", flex: 1 }}>
          <div style={{ marginBottom: "12px" }}>
            <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.12em", color: "#8a8477", padding: "4px 10px", textTransform: "uppercase" }}>
              {sectionHeading}
            </div>
            {roleNavItems.map(({ id, label, sub, href, icon: Icon }) => {
              const isActive =
                page === id ||
                (id === "queue" && page === "case_file") ||
                (id === "notices" && page === "letters");
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
          </div>
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

      <div className="review-content-area">
        <header className="review-header">
          <div className="review-breadcrumb">
            <Search size={14} className="breadcrumb-search-icon" />
            <span>ZOOMIN</span>
            <span className="breadcrumb-sep">/</span>
            <span className="breadcrumb-current">
              {ALL_NAV_ITEMS.find((item) => item.id === page)?.label.toUpperCase() ?? page.toUpperCase()}
            </span>
          </div>

          <div className="review-header-tools">
            <NotificationBell role={activeRole} />

            {/* Admin-only Demo Controls Drawer Trigger */}
            {isDemoMode && activeRole === "admin" && (
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
              <span className="review-user-email">
                {email || (activeRole === "admin" ? "admin@zoomin.gov" : activeRole === "applicant" ? "applicant@institution.edu" : "officer@zoomin.gov")}
              </span>
              <b className="review-user-role">{ROLE_LABELS[activeRole]}</b>
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
          {children}
          <footer className="review-footer-note">Indicators for human review, not decisions.</footer>
        </main>
      </div>

      {/* Admin-only Demo Controls Drawer */}
      {isDemoMode && activeRole === "admin" && drawerOpen && (
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
