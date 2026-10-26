"use client";

import { OfficerShell } from "@/components/officer-shell";
import { AuditWorkspace } from "@/components/audit-workspace";
import { useWorkspaceIdentity } from "@/lib/use-workspace-identity";

export default function AuditPage() {
  const { email, role } = useWorkspaceIdentity();

  return (
    <OfficerShell page="audit" email={email} role={role}>
      <AuditWorkspace role={role} />
    </OfficerShell>
  );
}
