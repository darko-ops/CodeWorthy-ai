// The wordmark: one token, "Code" in ink navy, "Worthy" in green.
export function Wordmark({ size = 18 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      Code<span className="worthy">Worthy</span>
    </span>
  );
}
