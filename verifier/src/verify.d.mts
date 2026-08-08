// Hand-written declarations so the server's TypeScript test suite can import
// the verifier for integration testing. The verifier itself never imports
// server code; this file only types its public surface.
export interface VerifierCheck {
  name: string;
  status: "pass" | "fail" | "skip";
  detail: string;
  findings: string[];
}
export interface VerifierReport {
  verdict: "pass" | "fail" | "verified-with-findings";
  exitCode: 0 | 2 | 3;
  checks: VerifierCheck[];
  trustBoundary: string;
}
export declare const SUPPORTED_FORMATS: string[];
export declare function loadPackage(path: string): Map<string, Buffer>;
export declare function verifyPackage(
  files: Map<string, Buffer>,
  opts?: { publicKeyPem?: string | null }
): VerifierReport;
