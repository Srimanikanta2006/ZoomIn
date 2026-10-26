"use client";

import { OfficerShell } from "@/components/officer-shell";
import { NoticesWorkspace } from "@/components/notices-workspace";
import { useWorkspaceIdentity } from "@/lib/use-workspace-identity";

export default function DeficiencyLettersPage() {
  const { email, role } = useWorkspaceIdentity();

  return (
    <OfficerShell page="notices" email={email} role={role}>
      <NoticesWorkspace />
    </OfficerShell>
  );
}
