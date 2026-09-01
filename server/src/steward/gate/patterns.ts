// Secret-detection patterns for the server-side gate.
//
// The source of truth is `checkup/secret-patterns.mjs` — shared by the checkup
// engine and the Actions-based PR gate, both plain Node. The server is compiled
// TypeScript and cannot import across the package boundary without dragging the
// build layout outside `src/`, so the list is mirrored here and a parity test
// (patterns.test.ts) reads the .mjs source and fails the build if the two ever
// diverge. Same mechanism as the client doctrine test: the rule is CI, not
// reviewer vigilance.
export const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/AKIA[0-9A-Z]{16}/, "AWS access key"],
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, "private key"],
  [/sk[-_](?:live|test)[-_][A-Za-z0-9]{10,}/i, "Stripe secret key"],
  [/sk-[A-Za-z0-9]{20,}/, "API secret key"],
  [/gh[pousr]_[A-Za-z0-9]{20,}/, "GitHub token"],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "JWT / signed token"],
  [/(?:secret|token|api[_-]?key|password|passwd|access[_-]?key|private[_-]?key)\s*[:=]\s*['"][A-Za-z0-9._\-\/+]{12,}['"]/i, "hard-coded credential"],
];
