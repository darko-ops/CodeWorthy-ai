import { STATUS_LABEL, type CandidateStatus } from "../data";

// Chip variant per pipeline status; solid green stays reserved for "report
// ready". The label always carries the meaning, never color alone.
const VARIANT: Record<CandidateStatus, string> = {
  invited: "",
  in_progress: " badge-amber",
  submitted: " badge-blue",
  defense: " badge-violet",
  reported: " badge-solid",
};

export function StatusBadge({ status }: { status: CandidateStatus }) {
  return (
    <span className={`badge${VARIANT[status]}`}>
      {status === "reported" ? "✓ " : ""}
      {STATUS_LABEL[status]}
    </span>
  );
}
