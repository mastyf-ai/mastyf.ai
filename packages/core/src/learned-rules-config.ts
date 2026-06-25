import { homedir } from "node:os";
import { join } from "node:path";

export function learnedRulesEnabled(): boolean {
  return process.env["MASTYF_AI_LEARNED_RULES_ENABLED"] === "true";
}

export function learnedRulesPath(): string {
  const raw = process.env["MASTYF_AI_LEARNED_RULES_PATH"]
    || join(homedir(), ".mastyf-ai", "learned-rules.json");
  return raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw;
}

export function learnedRulesMaxTotal(): number {
  const n = parseInt(process.env["MASTYF_AI_LEARNED_RULES_MAX_TOTAL"] || "200", 10);
  return Number.isFinite(n) && n > 0 ? n : 200;
}

export function learnedRulesReloadMs(): number {
  const n = parseInt(process.env["MASTYF_AI_LEARNED_RULES_RELOAD_MS"] || "60000", 10);
  return Number.isFinite(n) && n >= 0 ? n : 60_000;
}
