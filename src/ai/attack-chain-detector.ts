/**
 * Multi-Step Attack Chain Detector
 *
 * Tracks sequences of tool calls within a session to detect composite,
 * multi-stage attack campaigns before catastrophic exfiltration occurs.
 *
 * Example:
 *   Step 1: read_file(/etc/passwd)
 *   Step 2: read_file(.aws/credentials)
 *   Step 3: curl / push_files (Exfiltration Attempt)
 */

export interface TrackedCall {
  sessionId: string;
  serverName: string;
  toolName: string;
  arguments: Record<string, unknown>;
  timestamp: number;
  blocked: boolean;
}

export interface AttackChainMatch {
  chainName: string;
  severity: 'high' | 'critical';
  confidence: number;
  description: string;
  matchedSteps: Array<{ toolName: string; matchedPattern: string }>;
}

interface AttackChainDefinition {
  name: string;
  severity: 'high' | 'critical';
  description: string;
  steps: Array<{
    toolNameMatch?: RegExp;
    argPatternMatch?: RegExp;
  }>;
}

const KNOWN_ATTACK_CHAINS: AttackChainDefinition[] = [
  {
    name: 'Credential Discovery & Data Exfiltration',
    severity: 'critical',
    description: 'Agent reads sensitive credential files followed by an outbound network transmission.',
    steps: [
      {
        argPatternMatch: /(?:\.env|\.aws\/credentials|\.ssh\/id_rsa|passwd|shadow|\.git-credentials)/i,
      },
      {
        toolNameMatch: /(?:curl|wget|fetch|push_files|git_push|post|send_mail|webhook)/i,
      },
    ],
  },
  {
    name: 'Privilege Escalation & Backdoor Installation',
    severity: 'critical',
    description: 'Agent probes user identities and attempts to modify system permissions or sudoers.',
    steps: [
      {
        argPatternMatch: /(?:whoami|id|cat \/etc\/passwd|uname)/i,
      },
      {
        argPatternMatch: /(?:sudoers|NOPASSWD|chmod \+s|usermod -aG|chown root)/i,
      },
    ],
  },
  {
    name: 'Database Schema Reconnaissance & Dump',
    severity: 'high',
    description: 'Agent performs schema introspection followed by bulk table dump queries.',
    steps: [
      {
        argPatternMatch: /(?:information_schema|__schema|list_tables|SHOW TABLES)/i,
      },
      {
        argPatternMatch: /(?:SELECT \* FROM|pg_dump|mysqldump|LOAD_FILE|INTO OUTFILE)/i,
      },
    ],
  },
];

export class AttackChainDetector {
  private sessionHistory = new Map<string, TrackedCall[]>();
  private readonly windowMs: number;

  constructor(options?: { windowMs?: number }) {
    this.windowMs = options?.windowMs ?? 600000; // 10-minute sliding session window
  }

  public recordCall(call: TrackedCall): AttackChainMatch | null {
    const now = Date.now();
    if (!this.sessionHistory.has(call.sessionId)) {
      this.sessionHistory.set(call.sessionId, []);
    }

    const history = this.sessionHistory.get(call.sessionId)!;
    history.push(call);

    // Prune calls older than the sliding window
    const pruned = history.filter((c) => now - c.timestamp <= this.windowMs);
    this.sessionHistory.set(call.sessionId, pruned);

    // Evaluate pruned history against known chain definitions
    return this.evaluateChains(pruned);
  }

  private evaluateChains(history: TrackedCall[]): AttackChainMatch | null {
    if (history.length < 2) return null;

    for (const chain of KNOWN_ATTACK_CHAINS) {
      const matchedSteps: Array<{ toolName: string; matchedPattern: string }> = [];
      let stepIndex = 0;

      for (const call of history) {
        const expectedStep = chain.steps[stepIndex];
        if (!expectedStep) break;

        const argsStr = JSON.stringify(call.arguments);
        const toolMatch = !expectedStep.toolNameMatch || expectedStep.toolNameMatch.test(call.toolName);
        const argMatch = !expectedStep.argPatternMatch || expectedStep.argPatternMatch.test(argsStr);

        if (toolMatch && argMatch) {
          matchedSteps.push({
            toolName: call.toolName,
            matchedPattern: expectedStep.argPatternMatch?.source || expectedStep.toolNameMatch?.source || 'matched',
          });
          stepIndex++;
          if (stepIndex === chain.steps.length) {
            return {
              chainName: chain.name,
              severity: chain.severity,
              confidence: 0.92,
              description: chain.description,
              matchedSteps,
            };
          }
        }
      }
    }

    return null;
  }

  public clearSession(sessionId: string): void {
    this.sessionHistory.delete(sessionId);
  }
}

export const globalAttackChainDetector = new AttackChainDetector();
