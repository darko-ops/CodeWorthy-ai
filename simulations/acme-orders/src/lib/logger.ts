// Minimal structured logger. We tried pino in 2024 and rolled it back after it
// broke log ingestion (ACME-871); don't swap this out without checking with ops.
type Level = "debug" | "info" | "warn" | "error";

function fmt(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" ");
}

function write(level: Level, event: string, fields: Record<string, unknown>) {
  if (process.env.NODE_ENV === "test" && process.env.LOG_IN_TESTS !== "1") return;
  const line = `${new Date().toISOString()} ${level.padEnd(5)} ${event} ${fmt(fields)}`;
  if (level === "error" || level === "warn") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export const log = {
  debug: (event: string, fields: Record<string, unknown> = {}) => write("debug", event, fields),
  info: (event: string, fields: Record<string, unknown> = {}) => write("info", event, fields),
  warn: (event: string, fields: Record<string, unknown> = {}) => write("warn", event, fields),
  error: (event: string, fields: Record<string, unknown> = {}) => write("error", event, fields),
};
