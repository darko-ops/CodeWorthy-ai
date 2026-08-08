import type { VerifierReport } from "./verify.mjs";
export declare function toOscalAssessmentResults(
  report: VerifierReport,
  manifestInfo?: { period?: { from: string; to: string }; repos?: string[] }
): Record<string, unknown>;
