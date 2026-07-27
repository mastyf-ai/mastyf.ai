/**
 * Optional federated sharing of anonymized behavioral fingerprints.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface BehavioralFingerprintHint {
  toolName: string;
  score: number;
  serverHash: string;
  at?: string;
}

function storePath(): string {
  const dir = join(homedir(), '.mastyf-ai');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'behavioral-fingerprints.jsonl');
}

/** Persist anonymized fingerprint locally; optionally sync via fleetsignature exchange. */
export function shareBehavioralFingerprint(hint: BehavioralFingerprintHint): void {
  const toolHash = createHash('sha256').update(hint.toolName).digest('hex').slice(0, 16);
  const line = JSON.stringify({
    kind: 'behavioral',
    toolHash,
    serverHash: hint.serverHash,
    scoreBucket: Math.round(hint.score * 10) / 10,
    at: hint.at || new Date().toISOString(),
  });
  appendFileSync(storePath(), line + '\n');

  // Best-effort push into federated signature catalog shape
  if (process.env.MASTYF_AI_FEDERATED_SYNC === 'true') {
    void import('../utils/federated-signature-exchange.js')
      .then(async (mod) => {
        if (typeof mod.syncFleetSignatureHintsFromCloud === 'function') {
          await mod.syncFleetSignatureHintsFromCloud();
        }
      })
      .catch(() => undefined);
  }
}

export function loadRecentBehavioralHints(limit = 50): BehavioralFingerprintHint[] {
  const path = storePath();
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean).slice(-limit);
  return lines
    .map((l) => {
      try {
        const j = JSON.parse(l) as {
          toolHash?: string;
          scoreBucket?: number;
          serverHash?: string;
          at?: string;
        };
        return {
          toolName: j.toolHash || 'unknown',
          score: j.scoreBucket ?? 0,
          serverHash: j.serverHash || '',
          at: j.at,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as BehavioralFingerprintHint[];
}
