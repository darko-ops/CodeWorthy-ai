import { Link } from "react-router-dom";
import {
  averageRating,
  candidateById,
  COMPARE,
  COMPETENCIES,
  STATUS_LABEL,
  VERIFICATIONS,
  type Recommendation,
} from "../../data";

// Light-surface cell colors from the mockup's cell() helper.
function cellStyle(v: number | null) {
  if (v === null) return { txt: "—", bg: "#f7f9fa", color: "#9aa9ae", border: "#eef2f4", word: "not assessed" };
  if (v >= 4) return { txt: `${v}/5`, bg: "#e6f6f4", color: "#0f8b82", border: "#b9e6e1", word: "Strong" };
  if (v === 3) return { txt: `${v}/5`, bg: "#fdf6e3", color: "#b58600", border: "#f0d894", word: "Developing" };
  return { txt: `${v}/5`, bg: "#fdeceb", color: "#c0392b", border: "#f4c4bf", word: "Needs work" };
}

const REC_STYLE: Record<Recommendation, { color: string; bg: string; border: string }> = {
  Advance: { color: "#0f8b82", bg: "#e6f6f4", border: "#b9e6e1" },
  "In review": { color: "#7a4fd0", bg: "#f6f1ff", border: "#d8c7f5" },
  Hold: { color: "#c0392b", bg: "#fdeceb", border: "#f4c4bf" },
};

// Only competencies at least one compared candidate has been rated on.
function comparedCompetencies(ids: string[]): string[] {
  const rated = new Set<string>();
  for (const id of ids) {
    for (const r of candidateById(id)?.ratings ?? []) rated.add(r.competency);
  }
  return COMPETENCIES.filter((c) => rated.has(c));
}

export function Compare() {
  const entries = COMPARE.map(({ candidateId, recommendation }) => {
    const c = candidateById(candidateId)!;
    const avg = averageRating(c);
    const v = VERIFICATIONS[candidateId];
    const passed = v ? v.checks.filter((x) => x.result === "pass").length : null;
    const partial = c.status !== "reported" && c.ratings.length > 0;
    return { c, avg, recommendation, v, passed, partial };
  });
  const rows = comparedCompetencies(COMPARE.map((e) => e.candidateId));
  const anyPartial = entries.find((e) => e.partial);

  return (
    <>
      <div className="crumb">
        <Link to="/dashboard">Candidates</Link> / <span className="here">Compare</span>
      </div>
      <div className="page-head" style={{ alignItems: "flex-end" }}>
        <div>
          <h1 style={{ fontSize: 28 }}>Compare candidates</h1>
          <p>
            <span className="artifact">ACME-1287</span> · duplicate-charge bug · {entries.length}{" "}
            candidates side by side.
          </p>
        </div>
        <button className="btn">+ Add candidate</button>
      </div>

      <div className="table-card" style={{ background: "#fff" }}>
        <div style={{ minWidth: 760 }}>
          {/* header */}
          <div className="compare-grid" style={{ borderBottom: "1px solid var(--hairline)" }}>
            <div className="lbl" style={{ font: "600 11px var(--mono)", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-faint)", alignItems: "flex-end" }}>
              Candidate
            </div>
            {entries.map(({ c, avg, v, passed, partial }) => (
              <div key={c.id} className="cell" style={{ padding: "20px 18px" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                  <div
                    className="ring"
                    style={{
                      width: 60,
                      height: 60,
                      background: `conic-gradient(#4cc9c0 ${avg !== null ? (avg / 5) * 100 : 0}%, #eef2f4 0)`,
                    }}
                    aria-label={avg !== null ? `average ${avg.toFixed(1)} of 5` : "no average yet"}
                  >
                    <div className="ring-inner" style={{ width: 47, height: 47, background: "#fff" }}>
                      <span style={{ font: "700 17px var(--mono)", color: "var(--ink)", lineHeight: 1 }}>
                        {avg !== null ? `${avg.toFixed(1)}${partial ? "*" : ""}` : "—"}
                      </span>
                      <span style={{ font: "500 7px var(--mono)", color: "var(--ink-faint)" }}>/ 5</span>
                    </div>
                  </div>
                  <Link to={`/dashboard/candidates/${c.id}`} style={{ font: "700 15px var(--sans)" }}>
                    {c.name}
                  </Link>
                  <span className={`badge${c.status === "reported" ? " badge-solid" : " badge-violet"}`} style={{ fontSize: 10 }}>
                    {c.status === "reported" ? "✓ " : ""}
                    {STATUS_LABEL[c.status]}
                  </span>
                  <div style={{ font: "500 11px var(--mono)", color: "var(--ink-muted)" }}>
                    Hidden suite{" "}
                    <span
                      style={{
                        fontWeight: 700,
                        color:
                          v && passed === v.checks.length ? "var(--signal-deep)" : "#c0392b",
                      }}
                    >
                      {v ? `${passed} / ${v.checks.length}` : "—"}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* competency rows */}
          {rows.map((name) => (
            <div key={name} className="compare-grid" style={{ borderBottom: "1px solid #f2f5f6" }}>
              <div className="lbl">{name}</div>
              {entries.map(({ c }) => {
                const rating = c.ratings.find((r) => r.competency === name)?.rating ?? null;
                const s = cellStyle(rating);
                return (
                  <div key={c.id} className="cell">
                    <span className="cmp-chip" style={{ color: s.color, background: s.bg, borderColor: s.border }}>
                      {s.txt}
                    </span>
                    <span className="cmp-word">{s.word}</span>
                  </div>
                );
              })}
            </div>
          ))}

          {/* recommendation */}
          <div className="compare-grid" style={{ background: "var(--ink-900)" }}>
            <div
              className="lbl"
              style={{
                background: "var(--ink-900)",
                borderRight: "1px solid var(--border-dark)",
                color: "#cfe0e4",
                font: "700 12px var(--mono)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                padding: "18px 20px",
              }}
            >
              Recommendation
            </div>
            {entries.map(({ c, recommendation }) => {
              const s = REC_STYLE[recommendation];
              return (
                <div key={c.id} className="cell" style={{ borderRight: "1px solid var(--border-dark)", padding: "16px 18px" }}>
                  <span
                    style={{
                      font: "700 13px var(--sans)",
                      color: s.color,
                      background: s.bg,
                      border: `1px solid ${s.border}`,
                      padding: "8px 18px",
                      borderRadius: 999,
                    }}
                  >
                    {recommendation}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {anyPartial && (
        <p style={{ font: "400 12px var(--sans)", color: "var(--ink-faint)", margin: "14px 0 0" }}>
          * {anyPartial.c.name.split(" ")[0]}'s profile is partial — {anyPartial.c.ratings.length}{" "}
          competencies rated so far; the defense round completes the rest. "Not assessed" is never
          counted as a failure.
        </p>
      )}
    </>
  );
}
