"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useCallback } from "react";
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

  // Active persona role (synced with sessionStorage or default)
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
    if (initialRole) {
      setActiveRole(initialRole);
    } else {
      // Auto-adapt to current view in demo mode
      if (page === "portal") setActiveRole("applicant");
      else if (page === "rules" || page === "metrics" || page === "audit") setActiveRole("admin");
      else setActiveRole("scrutiny_officer");
    }
  }, [initialRole, page]);

  // Persona Switcher: 1-click switch between Scrutiny Officer, Admin, and Applicant with smooth SPA transition
  const switchPersona = useCallback((newRole: Role) => {
    setActiveRole(newRole);
    if (typeof window !== "undefined") {
      const demoEmail =
        newRole === "admin"
          ? "admin@zoomin.gov"
          : newRole === "applicant"
          ? "applicant@institution.edu"
          : "officer@zoomin.gov";
      const demoUser = {
        id:
          newRole === "admin"
            ? "10000000-0000-4000-8000-000000000001"
            : newRole === "applicant"
            ? "10000000-0000-4000-8000-000000000003"
            : "10000000-0000-4000-8000-000000000002",
        email: demoEmail,
        app_metadata: { role: newRole },
        user_metadata: { role: newRole },
      };
      sessionStorage.setItem("zoomin_demo_user", JSON.stringify(demoUser));
      sessionStorage.setItem("zoomin_demo_role", newRole);
    }
    const targetUrl = newRole === "applicant" ? "/portal" : newRole === "admin" ? "/rules" : "/officer";
    router.push(targetUrl);
  }, [router]);

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

  // Group nav items by section
  const sections = ["Scrutiny", "Administration", "Institution"] as const;

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

        {/* Persona Switcher Chips */}
        <div style={{ marginBottom: "14px", padding: "8px 10px", background: "#f2eee5", borderRadius: "10px", border: "1px solid #e7e0d1" }}>
          <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", color: "#4d5a3d", marginBottom: "6px", textTransform: "uppercase" }}>
            Active Persona
          </div>
          <div style={{ display: "flex", gap: "4px" }}>
            <button
              type="button"
              onClick={() => switchPersona("scrutiny_officer")}
              style={{
                flex: 1,
                padding: "4px 2px",
                fontSize: "10.5px",
                fontWeight: activeRole === "scrutiny_officer" ? 700 : 500,
                borderRadius: "6px",
                border: activeRole === "scrutiny_officer" ? "1px solid #4d5a3d" : "1px solid #d5cdbd",
                background: activeRole === "scrutiny_officer" ? "#4d5a3d" : "#ffffff",
                color: activeRole === "scrutiny_officer" ? "#ffffff" : "#4a5568",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              title="Switch to Scrutiny Officer"
            >
              Officer
            </button>
            <button
              type="button"
              onClick={() => switchPersona("admin")}
              style={{
                flex: 1,
                padding: "4px 2px",
                fontSize: "10.5px",
                fontWeight: activeRole === "admin" ? 700 : 500,
                borderRadius: "6px",
                border: activeRole === "admin" ? "1px solid #4d5a3d" : "1px solid #d5cdbd",
                background: activeRole === "admin" ? "#4d5a3d" : "#ffffff",
                color: activeRole === "admin" ? "#ffffff" : "#4a5568",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              title="Switch to Administrator"
            >
              Admin
            </button>
            <button
              type="button"
              onClick={() => switchPersona("applicant")}
              style={{
                flex: 1,
                padding: "4px 2px",
                fontSize: "10.5px",
                fontWeight: activeRole === "applicant" ? 700 : 500,
                borderRadius: "6px",
                border: activeRole === "applicant" ? "1px solid #4d5a3d" : "1px solid #d5cdbd",
                background: activeRole === "applicant" ? "#4d5a3d" : "#ffffff",
                color: activeRole === "applicant" ? "#ffffff" : "#4a5568",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              title="Switch to Institution Applicant"
            >
              Applicant
            </button>
          </div>
        </div>

        {/* Categorized Navigation List */}
        <nav aria-label="Role-scoped workspace navigation" className="sidebar-nav-list" style={{ overflowY: "auto", flex: 1 }}>
          {sections.map((section) => {
            const items = ALL_NAV_ITEMS.filter((i) => i.section === section);
            return (
              <div key={section} style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.12em", color: "#8a8477", padding: "4px 10px", textTransform: "uppercase" }}>
                  {section}
                </div>
                {items.map(({ id, label, sub, href, icon: Icon }) => {
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
