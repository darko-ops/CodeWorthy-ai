// The vitals meter — one bar per vital, colored by that vital's status. Replaces
// the conic-gradient health ring: it scales honestly, reads at a glance, and
// survives being small. The verdict WORD (rendered separately) carries the
// overall status in text; the bars are decorative to a screen reader.
import type { VitalStatus } from "../api";

export const VITAL_COLOR: Record<VitalStatus, string> = {
  healthy: "var(--signal)",
  watch: "var(--watch)",
  "at risk": "var(--risk)",
  unknown: "var(--unknown)",
};

export function VitalsMeter({
  vitals,
  sm = false,
}: {
  vitals: { id: string; label: string; status: VitalStatus }[];
  sm?: boolean;
}) {
  return (
    <div
      className={"vitals-meter" + (sm ? " sm" : "")}
      role="img"
      aria-label={vitals.map((v) => `${v.label}: ${v.status}`).join(", ")}
    >
      {vitals.map((v) => (
        <span key={v.id} style={{ background: VITAL_COLOR[v.status] ?? "var(--unknown)" }} />
      ))}
    </div>
  );
}
