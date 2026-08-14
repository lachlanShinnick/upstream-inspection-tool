/** The fixed internal recipients who can receive an inspection for approval. */
export type Approver = "dave" | "jackie";

const APPROVER_ENV_VAR: Record<Approver, string> = {
  dave: "REVIEW_RECIPIENT_EMAIL",
  jackie: "REVIEWER_JACKIE_EMAIL",
};

export const APPROVER_LABEL: Record<Approver, string> = {
  dave: "Dave",
  jackie: "Jackie",
};

export function isApprover(value: unknown): value is Approver {
  return value === "dave" || value === "jackie";
}

export function approverEmails(approver: Approver): string[] {
  return (process.env[APPROVER_ENV_VAR[approver]] ?? "")
    .split(/[,;]/)
    .map((recipient) => recipient.trim())
    .filter(Boolean);
}

export function approverEnvVar(approver: Approver): string {
  return APPROVER_ENV_VAR[approver];
}
