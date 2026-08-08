// The wordmark: "Codeworthy." — lowercase w, trailing period. "worthy" and the
// dot carry the teal accent (signal-deep on light, signal on dark).
export function Wordmark({ size = 20, onDark = false }: { size?: number; onDark?: boolean }) {
  return (
    <span className={"wordmark" + (onDark ? " on-dark" : "")} style={{ fontSize: size }}>
      Code<span className="worthy">worthy</span><span className="dot">.</span>
    </span>
  );
}
