"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { normalizeRole, type Role } from "@/lib/roles";

export function useWorkspaceIdentity() {
  const supabase = getSupabase();
  const [user, setUser] = useState<User | null>(() => {
    if (typeof window !== "undefined") {
      const demoUserJson = sessionStorage.getItem("zoomin_demo_user");
      if (demoUserJson) {
        try {
          return JSON.parse(demoUserJson) as User;
        } catch {}
      }
      const path = window.location.pathname;
      const fallbackRole: Role = path.startsWith("/portal")
        ? "applicant"
        : path.startsWith("/rules") || path.startsWith("/metrics") || path.startsWith("/audit")
        ? "admin"
        : "scrutiny_officer";
      const fallbackEmail =
        fallbackRole === "applicant"
          ? "applicant@institution.edu"
          : fallbackRole === "admin"
          ? "admin@zoomin.gov"
          : "officer@zoomin.gov";
      return { id: "demo-fallback-id", email: fallbackEmail, app_metadata: { role: fallbackRole } } as unknown as User;
    }
    return null;
  });

  const [role, setRole] = useState<Role | null>(() => {
    if (typeof window !== "undefined") {
      const demoRole = sessionStorage.getItem("zoomin_demo_role") as Role | null;
      if (demoRole) return demoRole;
      const path = window.location.pathname;
      return path.startsWith("/portal")
        ? "applicant"
        : path.startsWith("/rules") || path.startsWith("/metrics") || path.startsWith("/audit")
        ? "admin"
        : "scrutiny_officer";
    }
    return null;
  });

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    const isDemo = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
    if (!supabase) return;

    const loadRole = async (nextUser: User | null) => {
      setUser(nextUser);
      setRole(null);
      if (!nextUser) {
        if (isDemo && typeof window !== "undefined") {
          const path = window.location.pathname;
          const fallbackRole: Role = path.startsWith("/portal") ? "applicant" : path.startsWith("/rules") || path.startsWith("/metrics") || path.startsWith("/audit") ? "admin" : "scrutiny_officer";
          const fallbackEmail = fallbackRole === "applicant" ? "applicant@institution.edu" : fallbackRole === "admin" ? "admin@zoomin.gov" : "officer@zoomin.gov";
          setUser({ id: "demo-fallback-id", email: fallbackEmail, app_metadata: { role: fallbackRole } } as unknown as User);
          setRole(fallbackRole);
        }
        setLoading(false);
        return;
      }
      const claim = nextUser.app_metadata?.role;
      const claimedRole = normalizeRole(claim);
      if (claimedRole) {
        if (active) {
          setRole(claimedRole);
          setLoading(false);
        }
        return;
      }
      const { data, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", nextUser.id)
        .maybeSingle();
      if (active) {
        setRole(!error ? normalizeRole(data?.role) : (isDemo ? "scrutiny_officer" : null));
        setLoading(false);
      }
    };

    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        if (active) setLoading(false);
        return;
      }
      void loadRole(data.session?.user ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      void loadRole(session?.user ?? null);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  return { email: user?.email ?? "", role, loading };
}
