import type { VerifierReport } from "./verify.mjs";

export interface PopulationRow {
  seq: string;
  repo: string;
  pr_number: number | string;
  merge_sha: string;
  merged_at: string;
  author: string;
  merged_by: string;
  approvers: string;
  self_approved: "yes" | "no";
  red_checks_at_merge: string;
  evidence_gaps: string;
  instrumented: "full" | "webhook-only";
}

export declare function buildPopulation(
  files: Map<string, Buffer>,
  opts?: { publicKeyPem?: string | null }
): { ok: true; report: VerifierReport; population: PopulationRow[] } | { ok: false; report: VerifierReport; error: string };

export declare function populationCsv(population: PopulationRow[]): string;

export declare function buildSample(
  files: Map<string, Buffer>,
  sel: { mergeSha?: string; prNumber?: number; publicKeyPem?: string | null }
): { ok: true; report: VerifierReport; text: string; mergeRow: Record<string, unknown> } | { ok: false; report: VerifierReport; error: string };
