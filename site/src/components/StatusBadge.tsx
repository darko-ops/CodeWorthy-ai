import { STATUS_LABEL, type CandidateStatus } from "../data";

// Chip variants: green is reserved for "report ready / pass"; everything else
// reads as pending. The label always carries the meaning, never color alone.
export function StatusBadge({ status }: { status: CandidateStatus }) {
  const pass = status === "reported";
  return (
    <span className={`badge${pass ? " badge-pass" : ""}`}>
      {pass ? "✓ " : ""}
      {STATUS_LABEL[status]}
    </span>
  );
}
