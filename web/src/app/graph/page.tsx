"use client";

import { TrustAlertsWorkspace } from "@/components/trust-alerts-workspace";
import { OfficerShell } from "@/components/officer-shell";
import { useWorkspaceIdentity } from "@/lib/use-workspace-identity";

export default function TrustGraphPage() {
  const { email, role } = useWorkspaceIdentity();
  return (
    <OfficerShell page="trust_graph" email={email} role={role}>
      <TrustAlertsWorkspace />
    </OfficerShell>
  );
}
