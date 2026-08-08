// The evidence-package exporter CLI (V2).
//
//   npm run export -- --from 2026-01-01 --to 2026-07-01 [--repo owner/name]
//                     [--out DIR]
//
// Writes the package as a directory of files (the canonical artifact — every
// file hashed in manifest.json) plus a deterministic .tar.gz beside it.
// --repo scopes the DERIVED views (reconciliation, exceptions) only; the
// chain segment always carries every row in the period (see package.ts for
// why a filtered chain cannot verify).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { config } from "../config.js";
import { makeAnchor } from "../audit/tamper.js";
import { buildStatement, signStatement } from "./attest.js";
import { buildEvidencePackage, packageEntries } from "./package.js";
import { tarGz } from "./tar.js";

function parseArgs(argv: string[]): { from?: string; to?: string; repos: string[]; out?: string } {
  const out: { from?: string; to?: string; repos: string[]; out?: string } = { repos: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => argv[++i];
    if (a === "--from") out.from = next();
    else if (a === "--to") out.to = next();
    else if (a === "--repo") { const r = next(); if (r) out.repos.push(r); }
    else if (a === "--out") out.out = next();
  }
  return out;
}

// Dates arrive as YYYY-MM-DD or full ISO; normalize to full ISO instants.
function normalize(d: string, label: string): string {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00.000Z` : d;
  if (Number.isNaN(Date.parse(iso))) throw new Error(`--${label} is not a date: ${d}`);
  return new Date(iso).toISOString();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.from || !args.to) {
    console.error("usage: npm run export -- --from YYYY-MM-DD --to YYYY-MM-DD [--repo owner/name] [--out DIR]");
    process.exit(1);
  }
  const from = normalize(args.from, "from");
  const to = normalize(args.to, "to");

  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    const anchor = makeAnchor(config.anchor);
    const pkg = await buildEvidencePackage(pool, {
      from, to,
      repos: args.repos,
      anchor,
      anchorSource: config.anchor.s3Bucket
        ? `s3://${config.anchor.s3Bucket}/${config.anchor.s3Prefix ?? ""}anchors/ (Object Lock, compliance mode)`
        : config.anchor.file
          ? `append-only file: ${config.anchor.file}`
          : undefined,
    });

    const slug = (args.repos[0] ?? "all").replace(/[^a-zA-Z0-9_-]+/g, "-");
    const dirName = args.out ?? `evidence-${slug}-${from.slice(0, 10)}-${to.slice(0, 10)}`;
    await mkdir(dirName, { recursive: true });
    for (const [name, content] of pkg.files) await writeFile(join(dirName, name), content);

    // V4: sign when the operator holds an attestation key. attestation.json
    // travels beside the package (it signs the manifest, so it is not listed
    // in it) and rides inside the tarball for the single-file hand-off.
    const entries = packageEntries(pkg);
    const keyPem = process.env.STEWARD_ATTEST_KEY
      ?? (process.env.STEWARD_ATTEST_KEY_FILE ? await readFile(process.env.STEWARD_ATTEST_KEY_FILE, "utf8") : null);
    if (keyPem) {
      const envelope = signStatement(buildStatement(pkg), keyPem);
      const attBuf = Buffer.from(JSON.stringify(envelope, null, 2) + "\n", "utf8");
      await writeFile(join(dirName, "attestation.json"), attBuf);
      entries.push({ name: "attestation.json", content: attBuf });
      entries.sort((a, b) => (a.name < b.name ? -1 : 1));
      console.log(`[export] signed: attestation.json (keyid ${envelope.signatures[0]!.keyid})`);
    } else {
      console.log("[export] unsigned (set STEWARD_ATTEST_KEY or STEWARD_ATTEST_KEY_FILE to sign; npm run attest:keygen)");
    }
    await writeFile(`${dirName}.tar.gz`, tarGz(entries));

    console.log(`[export] ${pkg.rowCount} event(s) → ${dirName}/ and ${dirName}.tar.gz`);
    console.log(`[export] manifest sha256 of events.jsonl: ${(pkg.manifest as any).files["events.jsonl"]}`);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
