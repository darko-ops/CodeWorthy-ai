// Parses a repo's .steward.yml. Absence means safe defaults. Every gate is
// overridable, but only with a logged reason (enforced where gates are applied,
// M2+). This module just resolves the effective config.
import { parse } from "yaml";

export interface StewardConfig {
  gates: {
    secrets: "gate" | "advise" | "off";
    destructiveMigration: "gate" | "advise" | "off";
    committedDependencies: "gate" | "advise" | "off";
  };
  mergeCooldownMinutes: number;
  protectedPaths: string[];
  llm: { enabled: boolean };
}

export const DEFAULT_CONFIG: StewardConfig = {
  gates: { secrets: "gate", destructiveMigration: "gate", committedDependencies: "gate" },
  mergeCooldownMinutes: 0,
  protectedPaths: [],
  llm: { enabled: false }, // opt-in; the LLM tier never runs unless a repo turns it on
};

export function parseStewardConfig(raw: string | null | undefined): StewardConfig {
  if (!raw || !raw.trim()) return DEFAULT_CONFIG;
  let doc: any;
  try {
    doc = parse(raw) ?? {};
  } catch {
    return DEFAULT_CONFIG; // malformed config falls back to safe defaults, never crashes
  }
  return {
    gates: {
      secrets: level(doc?.gates?.secrets, DEFAULT_CONFIG.gates.secrets),
      destructiveMigration: level(doc?.gates?.destructive_migration, DEFAULT_CONFIG.gates.destructiveMigration),
      committedDependencies: level(doc?.gates?.committed_dependencies, DEFAULT_CONFIG.gates.committedDependencies),
    },
    mergeCooldownMinutes: Number.isFinite(doc?.merge_cooldown_minutes) ? Math.max(0, doc.merge_cooldown_minutes) : 0,
    protectedPaths: Array.isArray(doc?.protected_paths) ? doc.protected_paths.map(String) : [],
    llm: { enabled: doc?.llm?.enabled === true },
  };
}

function level(v: unknown, fb: "gate" | "advise" | "off"): "gate" | "advise" | "off" {
  return v === "gate" || v === "advise" || v === "off" ? v : fb;
}
