export declare const DSSE_PAYLOAD_TYPE: string;
export declare const STATEMENT_TYPE: string;
export declare const SUPPORTED_PREDICATES: string[];
export declare function pae(payloadType: string, payload: Buffer): Buffer;
export declare function verifyAttestation(
  files: Map<string, Buffer>,
  publicKeyPem: string | null
): { status: "pass" | "fail" | "skip"; detail: string; findings: string[]; statement?: Record<string, unknown> };
