"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { normalizeRole, ROLE_LABELS, type Role } from "@/lib/roles";
import { ShieldCheck, Search, LogOut, ArrowRight, CheckCircle2, AlertCircle } from "lucide-react";

type ApiHealth = { status: string; service: string };
type VerificationStatus = "not_started" | "in_progress" | "verified" | "discrepancy" | "inconclusive" | "unable_to_verify";
type DemoStatus = { status: VerificationStatus; source: string; result: { reason: string }; requires_manual_review: boolean };
type DemoAccountRepair = { email: string; role: "admin" | "scrutiny_officer" | "institution" };

const demoStatusDefaults: DemoStatus[] = [
  { status: "not_started", source: "Demo status guide", result: { reason: "This check has not started." }, requires_manual_review: true },
  { status: "in_progress", source: "Demo status guide", result: { reason: "This check is still running." }, requires_manual_review: true },
  { status: "verified", source: "Demo status guide", result: { reason: "The source returned a matching record." }, requires_manual_review: false },
  { status: "discrepancy", source: "Demo status guide", result: { reason: "The source returned a mismatch." }, requires_manual_review: true },
  { status: "inconclusive", source: "Demo status guide", result: { reason: "The source did not return enough information." }, requires_manual_review: true },
  { status: "unable_to_verify", source: "Demo status guide", result: { reason: "The source could not be reached or the file could not be checked." }, requires_manual_review: true },
];

const statusLabels: Record<VerificationStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  verified: "Verified",
  discrepancy: "Discrepancy",
  inconclusive: "Inconclusive",
  unable_to_verify: "Unable to verify",
};

export function AuthWorkspace() {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [demoAccountRepair, setDemoAccountRepair] = useState<DemoAccountRepair | null>(null);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");
  const [demoStatuses, setDemoStatuses] = useState<DemoStatus[]>(demoStatusDefaults);
  const [timeoutNotice, setTimeoutNotice] = useState("");
  const supabase = getSupabase();

  const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

  useEffect(() => {
    if (typeof window !== "undefined") {
      const notice = sessionStorage.getItem("zoomin_timeout") || sessionStorage.getItem("preflight_timeout");
      if (notice) {
        setTimeoutNotice(notice);
        sessionStorage.removeItem("zoomin_timeout");
        sessionStorage.removeItem("preflight_timeout");
      }
    }
  }, []);

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:7860";
    fetch(`${apiUrl.replace(/\/$/, "")}/health`)
      .then((response) => {
        if (!response.ok) throw new Error("API unavailable");
        return response.json() as Promise<ApiHealth>;
      })
      .then((result) => setHealth(result.status === "ok" ? "online" : "offline"))
      .catch(() => setHealth("offline"));

    fetch(`${apiUrl.replace(/\/$/, "")}/verification/demo-statuses`)
      .then((response) => {
        if (!response.ok) throw new Error("Status guide unavailable");
        return response.json() as Promise<DemoStatus[]>;
      })
      .then(setDemoStatuses)
      .catch(() => setDemoStatuses(demoStatusDefaults));

    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) setRole(null);
    });
    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    let active = true;
    async function loadRole(user: User | undefined) {
      if (!user || !supabase) {
        setRole(null);
        return;
      }
      const claim = user.app_metadata?.role;
      const claimedRole = normalizeRole(claim);
      if (claimedRole) {
        if (active) setRole(claimedRole);
        return;
      }
      const { data, error } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
      if (active) setRole(!error ? normalizeRole(data?.role) : null);
    }
    void loadRole(session?.user);
    return () => { active = false; };
  }, [session, supabase]);

  async function authenticate(nextEmail: string, nextPassword: string) {
    setMessage("");
    setDemoAccountRepair(null);
    if (!supabase) {
      setMessage("Add Supabase URL and anon key to web/.env.local.");
      return;
    }
    setBusy(true);
    const { error: auditError } = await supabase.rpc("append_audit_event", {
      p_action: "auth.login.attempt",
      p_details: {},
    });
    if (auditError) {
      setBusy(false);
      if (auditError.code === "PGRST202" || auditError.message?.includes("append_audit_event")) {
        setMessage("Database setup incomplete: please run web/supabase/complete_setup.sql in your Supabase SQL Editor.");
      } else {
        setMessage("Sign-in is unavailable because the audit log could not be written.");
      }
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email: nextEmail, password: nextPassword });
    if (!error) {
      try {
        await supabase.rpc("append_audit_event", {
          p_action: "auth.login.success",
          p_details: {},
        });
      } catch {
        // Audit log writing degrades gracefully
      }
    }
    setBusy(false);
    if (error?.message === "Database error querying schema") {
      const demoAccounts: Record<string, DemoAccountRepair["role"]> = {
        "admin@zoomin.gov": "admin",
        "admin@preflight.gov": "admin",
        "admin@preflight.org": "admin",
        "officer@zoomin.gov": "scrutiny_officer",
        "officer@preflight.gov": "scrutiny_officer",
        "applicant@institution.edu": "institution",
      };
      const demoRole = demoAccounts[nextEmail.toLowerCase()];
      if (demoRole) setDemoAccountRepair({ email: nextEmail, role: demoRole });
      setMessage("Supabase Auth could not read this account. It may have been created by older setup SQL.");
    } else if (error?.message === "Invalid login credentials") {
      setMessage("Email or password is incorrect. Check the demo credentials or use an account assigned by your administrator.");
    } else {
      setMessage(error?.message ?? "Signed in.");
    }
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await authenticate(email, password);
  }

  async function quickDemoSignIn(nextEmail: string) {
    const demoPassword = "password123";
    setEmail(nextEmail);
    setPassword(demoPassword);
    await authenticate(nextEmail, demoPassword);
  }

  async function signOut() {
    if (supabase) {
      try {
        await supabase.rpc("append_audit_event", {
          p_action: "auth.logout",
          p_details: {},
        });
      } catch {
        // degrade gracefully
      }
      await supabase.auth.signOut().catch(() => {});
    }
    setSession(null);
    setRole(null);
    setMessage("Signed out.");
  }

  return (
    <div className="falcon-login-root">
      {/* Falcon Video Hero Left Pane */}
      <section className="falcon-photo-section">
        <video
          className="falcon-video falcon-video--tall"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
        >
          <source
            src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260813_052122_e77a27e6-17f1-4794-889b-3ceaa0e9e8cb.mp4"
            type="video/mp4"
          />
        </video>
        <video
          className="falcon-video falcon-video--wide"
          aria-hidden="true"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
        >
          <source
            src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260813_052122_e77a27e6-17f1-4794-889b-3ceaa0e9e8cb.mp4"
            type="video/mp4"
          />
        </video>
        <div className="falcon-scrim" />

        {/* Hero Overlay */}
        <div className="falcon-hero-overlay">
          <div className="falcon-badge">
            <svg viewBox="0 0 582 557" fillRule="evenodd" className="falcon-badge-glyph">
              <path d="M449.0 0.0 435.0 0.0 415.0 10.0 200.0 249.0 187.0 276.0 189.0 299.0 212.0 326.0 232.0 332.0 289.0 334.0 289.0 516.0 301.0 543.0 324.0 556.0 346.0 556.0 374.0 536.0 573.0 311.0 582.0 288.0 579.0 264.0 559.0 240.0 539.0 233.0 478.0 230.0 478.0 32.0 470.0 13.0ZM442.0 38.0 446.0 250.0 466.0 267.0 540.0 270.0 547.0 285.0 341.0 520.0 332.0 522.0 324.0 514.0 321.0 314.0 307.0 300.0 295.0 297.0 233.0 297.0 224.0 291.0 221.0 282.0ZM1.0 67.0 4.0 81.0 17.0 90.0 216.0 90.0 223.0 87.0 232.0 74.0 228.0 57.0 215.0 49.0 18.0 49.0 5.0 57.0ZM0.0 285.0 4.0 300.0 17.0 308.0 105.0 308.0 118.0 299.0 121.0 291.0 119.0 278.0 111.0 270.0 103.0 267.0 17.0 267.0 4.0 275.0ZM1.0 495.0 4.0 511.0 10.0 517.0 23.0 520.0 179.0 520.0 191.0 516.0 200.0 500.0 196.0 488.0 182.0 479.0 18.0 479.0 9.0 483.0Z" />
            </svg>
            <span>Built for AICTE Scrutiny Officers</span>
          </div>
          <div className="falcon-headlines">
            <span className="falcon-hl falcon-hl1">Verify Every Detail</span>
            <span className="falcon-hl falcon-hl2">With Confidence</span>
          </div>
          <div className="falcon-hero-footer">
            <span className="falcon-hero-note">Evidence-first scrutiny · Humans make every decision</span>
          </div>
        </div>
      </section>

      {/* Right Glass Card Pane */}
      <section className="falcon-form-pane">
        <div className="falcon-glass-card">
          {/* Top Brand Bar */}
          <div className="falcon-card-header">
            <div className="falcon-brand-title">
              <span className="falcon-lens-icon">
                <Search size={18} strokeWidth={2.4} />
              </span>
              <b>ZoomIn</b>
              <small>AICTE SCRUTINY</small>
            </div>
            <div className="falcon-header-status">
              <span className={`falcon-health-dot falcon-health-${health}`} />
              <span className="falcon-health-txt">API {health}</span>
            </div>
          </div>

          {session ? (
            /* Signed In Active Session State */
            <div className="falcon-signed-box" aria-live="polite">
              <div className="falcon-welcome-row">
                <span className="falcon-avatar-circle">
                  {session.user.email?.slice(0, 1).toUpperCase() ?? "U"}
                </span>
                <div>
                  <h2 className="falcon-welcome-h2">Welcome to ZoomIn</h2>
                  <p className="falcon-user-email">{session.user.email}</p>
                </div>
              </div>

              <div className="falcon-role-chip-card">
                <span className="falcon-role-label">ASSIGNED ROLE</span>
                <strong className="falcon-role-val">{role ? ROLE_LABELS[role] : "Role not assigned yet"}</strong>
                <p className="falcon-role-desc">
                  {role === "applicant"
                    ? "Manage institution profile, upload compliance documents, and respond to deficiency notices."
                    : role === "admin"
                    ? "Configure AICTE handbook validation rules, review live precision/recall metrics, and inspect tamper-proof audit trails."
                    : "Review priority triage lanes, verify document seals/signatures, and draft deficiency letters."}
                </p>
              </div>

              <div className="falcon-action-row">
                {role && (
                  <Link
                    className="falcon-primary-btn"
                    href={role === "applicant" ? "/portal" : role === "admin" ? "/rules" : "/officer"}
                  >
                    <span>{role === "applicant" ? "Open My Applications" : role === "admin" ? "Open Admin Console" : "Open Officer Queue"}</span>
                    <ArrowRight size={16} />
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="falcon-secondary-btn"
                >
                  <LogOut size={14} />
                  <span>Sign out</span>
                </button>
              </div>
            </div>
          ) : (
            /* Sign In Form */
            <div className="falcon-signin-content">
              <div className="falcon-headings">
                <h1 className="falcon-h1">Welcome Back!</h1>
                <p className="falcon-sub">
                  <b>Log in</b> to continue scrutiny of AICTE applications.
                </p>
              </div>

              {timeoutNotice && (
                <div className="falcon-timeout-alert">
                  <AlertCircle size={15} />
                  <span>{timeoutNotice}</span>
                </div>
              )}

              {/* Quick Demo Accounts Selection */}
              {isDemoMode && (
                <div className="falcon-quick-demo-box">
                  <span className="falcon-demo-kicker">QUICK DEMO ROLES</span>
                  <div className="falcon-demo-chips">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void quickDemoSignIn("admin@preflight.org")}
                      className="falcon-demo-chip"
                    >
                      Admin
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void quickDemoSignIn("officer@preflight.gov")}
                      className="falcon-demo-chip"
                    >
                      Scrutiny Officer
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void quickDemoSignIn("applicant@institution.edu")}
                      className="falcon-demo-chip"
                    >
                      Applicant
                    </button>
                  </div>
                </div>
              )}

              <form onSubmit={signIn} className="falcon-form">
                <div className="falcon-field">
                  <label htmlFor="email" className="sr-only">Email address</label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    aria-label="Email address"
                    placeholder="Eg. officer@zoomin.gov"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="falcon-field">
                  <label htmlFor="password" className="sr-only">Password</label>
                  <input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    aria-label="Password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>

                <button id="loginBtn" className="falcon-login-btn" type="submit" disabled={busy}>
                  <span>{busy ? "Authenticating…" : "Login"}</span>
                  <svg className="falcon-arrow-svg" viewBox="0 0 22 22">
                    <path d="M3 11h15.4M11 3.3l7.7 7.7-7.7 7.7" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  </svg>
                </button>

                {message && (
                  <p className="falcon-form-message" role="status">
                    {message}
                  </p>
                )}
              </form>

              {demoAccountRepair && (
                <div className="falcon-repair-box">
                  <strong>Repair this demo login: {demoAccountRepair.email}</strong>
                  <ol>
                    <li>In Supabase, open <strong>Authentication → Users</strong> and add <code>{demoAccountRepair.email}</code> with password <code>password123</code>.</li>
                    <li>In <strong>SQL Editor</strong>, run the role assignment for <code>{demoAccountRepair.role}</code>.</li>
                  </ol>
                </div>
              )}

              <div className="falcon-divider">
                <i />
                <b>OR</b>
                <i />
              </div>

              <button
                id="gBtn"
                type="button"
                className="falcon-google-btn"
                onClick={() => {
                  setMessage("Google SSO requires production OAuth credentials in Supabase. Use email or Quick Demo.");
                }}
              >
                <svg viewBox="0 0 48 48" className="falcon-google-svg">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                </svg>
                <span>Sign in with Google</span>
              </button>

              <div className="falcon-assurance-footer">
                <CheckCircle2 size={14} className="falcon-check-icon" />
                <span>Indicators for human review, not automated decisions.</span>
              </div>
            </div>
          )}

          {/* Verification Statuses Expandable Footer */}
          <details className="falcon-status-guide-details">
            <summary className="falcon-status-guide-summary">
              <span>View verification status guide ({demoStatuses.length} types)</span>
            </summary>
            <div className="falcon-status-grid">
              {demoStatuses.map((item) => (
                <div key={item.status} className="falcon-status-item">
                  <span className={`falcon-status-pill status-${item.status}`}>
                    {statusLabels[item.status]}
                  </span>
                  <p>{item.result.reason}</p>
                </div>
              ))}
            </div>
          </details>
        </div>
      </section>
    </div>
  );
}
