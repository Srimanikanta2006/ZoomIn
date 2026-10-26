"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import type { Role } from "@/lib/roles";
import { getSupabase } from "@/lib/supabase";

interface NotificationItem {
  id: string;
  title: string;
  detail: string;
  href: string;
  createdAt: string;
}

interface ApplicationNoticeRow {
  id: string;
  application_number: string;
  application_type: string;
  status: string;
  created_at: string;
  submitted_at: string | null;
}

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function NotificationBell({ role }: { role: Role | null }) {
  const supabase = getSupabase();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  const loadNotifications = useCallback(async () => {
    if (!supabase || !role) return;
    setError("");

    const now = Date.now();
    const recentAfter = new Date(now - RECENT_WINDOW_MS).toISOString();
    try {
      const { data: appRows, error: appError } = await supabase
        .from("applications")
        .select("id,application_number,application_type,status,created_at,submitted_at")
        .order("updated_at", { ascending: false })
        .limit(100);
      if (appError) throw appError;

      const applications = (appRows ?? []) as ApplicationNoticeRow[];
      const next: NotificationItem[] = [];
      const applicationById = new Map(applications.map((application) => [application.id, application]));

      if (role !== "applicant") {
        for (const application of applications) {
          if (application.status !== "submitted" || application.created_at < recentAfter) continue;
          next.push({
            id: `new:${application.id}`,
            title: "New application",
            detail: application.application_number,
            href: `/case/${application.id}`,
            createdAt: application.created_at,
          });
        }

        const applicationIds = applications.map((application) => application.id);
        if (applicationIds.length) {
          const { data: docs, error: docsError } = await supabase
            .from("documents")
            .select("id,application_id,document_type,uploaded_at")
            .in("application_id", applicationIds)
            .gte("uploaded_at", recentAfter)
            .order("uploaded_at", { ascending: false })
            .limit(50);
          if (docsError) throw docsError;
          for (const document of docs ?? []) {
            const application = applicationById.get(document.application_id);
            if (!application) continue;
            next.push({
              id: `upload:${document.id}`,
              title: "Re-upload received",
              detail: `${application.application_number} · ${String(document.document_type).replaceAll("_", " ")}`,
              href: `/case/${application.id}`,
              createdAt: document.uploaded_at,
            });
          }

          const session = await supabase.auth.getSession();
          const token = session.data.session?.access_token;
          if (token) {
            const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:7860").replace(/\/$/, "");
            const response = await fetch(`${apiUrl}/workflow-config?view=officer_lanes`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!response.ok) throw new Error("Deadline settings could not be loaded.");
            const config = await response.json() as {
              officer_timelines?: { review_deadline_days?: number; approaching_deadline_days?: number };
            };
            const deadlineDays = config.officer_timelines?.review_deadline_days ?? 14;
            const approachingDays = config.officer_timelines?.approaching_deadline_days ?? 3;
            for (const application of applications) {
              if (!application.submitted_at || application.status === "completed") continue;
              const daysPending = Math.floor((now - new Date(application.submitted_at).getTime()) / 86400000);
              if (daysPending < deadlineDays - approachingDays || daysPending >= deadlineDays) continue;
              next.push({
                id: `deadline:${application.id}`,
                title: "Deadline approaching",
                detail: `${application.application_number} · ${deadlineDays - daysPending} days left`,
                href: `/case/${application.id}`,
                createdAt: application.submitted_at,
              });
            }
          }
        }
      } else {
        const appIds = applications.map((application) => application.id);
        if (appIds.length) {
          const { data: notices, error: noticesError } = await supabase
            .from("deficiency_letters")
            .select("id,application_id,approved_at")
            .in("application_id", appIds)
            .eq("status", "approved")
            .gte("approved_at", recentAfter)
            .order("approved_at", { ascending: false })
            .limit(30);
          if (noticesError) throw noticesError;
          for (const notice of notices ?? []) {
            const application = applicationById.get(notice.application_id);
            if (!application || !notice.approved_at) continue;
            next.push({
              id: `notice:${notice.id}`,
              title: "Notice issued",
              detail: application.application_number,
              href: "/portal",
              createdAt: notice.approved_at,
            });
          }
        }
      }

      next.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      setItems(next.slice(0, 20));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Notifications could not be loaded.");
    }
  }, [role, supabase]);

  useEffect(() => {
    if (!role || !supabase) return;
    void loadNotifications();
    const channel = supabase
      .channel("zoomin-notifications")
      .on("postgres_changes", { event: "*", schema: "public", table: "applications" }, () => void loadNotifications())
      .on("postgres_changes", { event: "*", schema: "public", table: "documents" }, () => void loadNotifications())
      .on("postgres_changes", { event: "*", schema: "public", table: "deficiency_letters" }, () => void loadNotifications())
      .subscribe();
    const fallbackTimer = window.setInterval(() => void loadNotifications(), 30000);
    return () => {
      window.clearInterval(fallbackTimer);
      void supabase.removeChannel(channel);
    };
  }, [loadNotifications, role, supabase]);

  if (!role) return null;

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        aria-label={`Notifications${items.length ? `, ${items.length} recent` : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={{ position: "relative", display: "grid", placeItems: "center", width: 32, height: 32, border: "1px solid #c4c6cf", borderRadius: 6, background: "#fff", color: "#334155", cursor: "pointer" }}
      >
        <Bell size={15} />
        {items.length > 0 && <span aria-hidden="true" style={{ position: "absolute", right: -4, top: -4, minWidth: 15, height: 15, padding: "0 3px", borderRadius: 8, background: "#b91c1c", color: "#fff", fontSize: 9, lineHeight: "15px", fontWeight: 700 }}>{items.length}</span>}
      </button>
      {open && (
        <section aria-label="Recent notifications" style={{ position: "absolute", zIndex: 30, right: 0, top: 38, width: 310, maxHeight: 360, overflowY: "auto", padding: 10, border: "1px solid #dcdad4", borderRadius: 8, background: "#fff", boxShadow: "0 8px 24px rgba(15,23,42,.14)" }}>
          <strong style={{ display: "block", padding: "4px 6px 8px", fontSize: 12, color: "#1e293b" }}>Recent notifications</strong>
          {error ? <p role="alert" style={{ padding: 6, fontSize: 12, color: "#991b1b" }}>{error}</p> : items.length === 0 ? <p style={{ padding: 6, fontSize: 12, color: "#64748b" }}>No recent notifications.</p> : items.map((item) => (
            <Link key={item.id} href={item.href} onClick={() => setOpen(false)} style={{ display: "block", padding: 8, borderTop: "1px solid #f1f5f9", color: "#1e293b", textDecoration: "none" }}>
              <span style={{ display: "block", fontSize: 12, fontWeight: 700 }}>{item.title}</span>
              <span style={{ display: "block", marginTop: 2, fontSize: 11, color: "#64748b" }}>{item.detail}</span>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
