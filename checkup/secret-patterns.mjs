// Shared secret-detection patterns — one source of truth for the checkup engine
// and the PR gate, so they can't drift. Pure module (no side effects).
// Ordered specific-prefix first, generic keyword-assignment last.
export const SECRET_PATTERNS = [
  [/AKIA[0-9A-Z]{16}/, "AWS access key"],
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, "private key"],
  [/sk[-_](?:live|test)[-_][A-Za-z0-9]{10,}/i, "Stripe secret key"],
  [/sk-[A-Za-z0-9]{20,}/, "API secret key"],
  [/gh[pousr]_[A-Za-z0-9]{20,}/, "GitHub token"],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "JWT / signed token"],
  [/(?:secret|token|api[_-]?key|password|passwd|access[_-]?key|private[_-]?key)\s*[:=]\s*['"][A-Za-z0-9._\-\/+]{12,}['"]/i, "hard-coded credential"],
];
