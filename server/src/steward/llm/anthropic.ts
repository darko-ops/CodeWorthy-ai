// The injectable LLM seam for the advise tier (M3).
//
// The reviewer depends on this small interface, never on the SDK directly, so
// tests run offline against a fake and prod runs against Anthropic. The real
// client is built ONLY when the tier is on AND an API key is present — no key
// means the whole tier is a no-op (deterministic-only degradation), never an
// error.
import Anthropic from "@anthropic-ai/sdk";

export interface LlmReviewRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  model?: string;
}

// Returns the parsed JSON object the model produced (validated against `schema`
// by the API's structured-output). Kept deliberately narrow. `model` names the
// model that will answer — recorded as provenance on every review's audit event
// so generated advice is never unattributed.
export interface LlmClient {
  readonly model?: string;
  review(req: LlmReviewRequest): Promise<unknown>;
}

// Default per the current Anthropic guidance: the most capable Opus.
const DEFAULT_MODEL = "claude-opus-5";

// Build the real client, or null when there's no ANTHROPIC_API_KEY — the caller
// treats null as "tier unavailable, stay deterministic-only."
export function getAnthropicClient(): LlmClient | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const anthropic = new Anthropic({ apiKey });

  return {
    model: DEFAULT_MODEL,
    async review(req: LlmReviewRequest): Promise<unknown> {
      // Stream + finalMessage: an LLM review can run long; streaming avoids
      // request timeouts. Structured output constrains the shape; adaptive
      // thinking lets the model reason about judgment calls.
      const stream = anthropic.messages.stream({
        model: req.model ?? DEFAULT_MODEL,
        max_tokens: 4096,
        thinking: { type: "adaptive" },
        output_config: { format: { type: "json_schema", schema: req.schema } },
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      });
      const msg = await stream.finalMessage();
      const text = msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      return JSON.parse(text);
    },
  };
}
