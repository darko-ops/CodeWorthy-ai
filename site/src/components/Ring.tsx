// Competency-average ring. Per the rule amendment: it is always labeled as an
// average, never appears without the full profile, and is never a pass/fail.
export function Ring({
  value,
  size = 150,
  sub = "average / 5.0",
}: {
  value: number | null;
  size?: number;
  sub?: string;
}) {
  const pct = value === null ? 0 : (value / 5) * 100;
  const inner = Math.round(size * 0.78);
  const valueFont = Math.round(size * 0.29);
  return (
    <div
      className="ring"
      role="img"
      aria-label={value === null ? "No competency average yet" : `Competency average ${value.toFixed(1)} out of 5`}
      style={{
        width: size,
        height: size,
        background: `conic-gradient(#4cc9c0 ${pct}%, #22384c 0)`,
      }}
    >
      <div className="ring-inner" style={{ width: inner, height: inner }}>
        <span className="ring-value" style={{ fontSize: valueFont }}>
          {value === null ? "—" : value.toFixed(1)}
        </span>
        {size >= 100 && <span className="ring-sub">{sub}</span>}
      </div>
    </div>
  );
}
