/**
 * Resolve vuln-findings.jsonl path (matches src/vuln-discovery/paths.ts).
 */
import { join } from 'node:path';
import { homedir } from 'node:os';

export function resolveVulnStoreDir() {
  const explicit = process.env.MASTYF_AI_VULN_STORE_DIR?.trim();
  if (explicit) return explicit;
  const home = process.env.MASTYF_AI_HOME?.trim();
  if (home) return home;
  return join(homedir(), '.mastyf-ai');
}

export function resolveVulnFindingsPath() {
  return join(resolveVulnStoreDir(), 'vuln-findings.jsonl');
}
