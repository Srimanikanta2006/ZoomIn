export const ROLES = [
  "applicant",
  "scrutiny_officer",
  "regional_officer",
  "admin",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  applicant: "Applicant",
  scrutiny_officer: "Scrutiny officer",
  regional_officer: "Regional officer",
  admin: "Admin",
};

export function normalizeRole(value: unknown): Role | null {
  if (value === "institution") return "applicant";
  return typeof value === "string" && ROLES.includes(value as Role) ? value as Role : null;
}
