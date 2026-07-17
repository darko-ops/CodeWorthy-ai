import { randomBytes } from "node:crypto";
import { log } from "../lib/logger";

// Client for PayFlow, our payment provider. In this environment it is
// simulated: captures always succeed after a configurable delay.
//
// PAYMENT_LATENCY_MS approximates provider latency. The sandbox default is
// 50ms, but production p99 has been observed above 4s during PayFlow
// incidents — see status.payflow.example notices from 2026-07-09.
export interface CaptureResult {
  captureId: string;
}

function latencyMs(): number {
  return parseInt(process.env.PAYMENT_LATENCY_MS ?? "50", 10);
}

export async function capturePayment(input: {
  amountCents: number;
  currency?: string;
  reference: string;
}): Promise<CaptureResult> {
  await new Promise((resolve) => setTimeout(resolve, latencyMs()));
  const captureId = `cap_${randomBytes(8).toString("hex")}`;
  log.info("payflow.capture", {
    capture_id: captureId,
    amount_cents: input.amountCents,
    reference: input.reference,
  });
  return { captureId };
}
