"use client";

import { OfficerShell } from "@/components/officer-shell";
import { RuleStudioWorkspace } from "@/components/rule-studio-workspace";
import { useWorkspaceIdentity } from "@/lib/use-workspace-identity";

export default function RuleStudioPage() {
  const { email, role } = useWorkspaceIdentity();

  return (
    <OfficerShell page="rules" email={email} role={role}>
      <RuleStudioWorkspace role={role} />
    </OfficerShell>
  );
}
