"use client";

import { OfficerShell } from "@/components/officer-shell";
import { MetricsWorkspace } from "@/components/metrics-workspace";
import { useWorkspaceIdentity } from "@/lib/use-workspace-identity";

export default function MetricsPage() {
  const { email, role } = useWorkspaceIdentity();

  return (
    <OfficerShell page="metrics" email={email} role={role}>
      <MetricsWorkspace />
    </OfficerShell>
  );
}
