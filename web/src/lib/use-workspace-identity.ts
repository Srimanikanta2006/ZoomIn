"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { normalizeRole, type Role } from "@/lib/roles";

export function useWorkspaceIdentity() {
  const supabase = getSupabase();
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let active = true;
    const loadRole = async (nextUser: User | null) => {
      setUser(nextUser);
      setRole(null);
      if (!nextUser) {
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
        setRole(!error ? normalizeRole(data?.role) : null);
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
