/**
 * MCP-specific risk classifier — analyzes package description and keywords
 * to classify tool capabilities and risk levels for MCP servers.
 */

export type ToolCapability = {
  name: string;
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  keywords: string[];
};

export type RiskClassification = {
  packageName: string;
  capabilities: ToolCapability[];
  overallRiskScore: number; // 0-100, lower = riskier
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  summary: string;
  recommendations: string[];
};

// ── MCP-specific capability patterns ──
const CAPABILITY_PATTERNS: ToolCapability[] = [
  {
    name: 'shell_execution',
    riskLevel: 'critical',
    description: 'Can execute arbitrary shell commands on the host system',
    keywords: ['exec', 'spawn', 'shell', 'command', 'process', 'child_process', 'bash', 'cmd'],
  },
  {
    name: 'filesystem_write',
    riskLevel: 'high',
    description: 'Can write files to the host filesystem',
    keywords: ['write', 'create', 'save', 'mkdir', 'unlink', 'rm', 'delete', 'move', 'rename', 'filesystem', 'fs'],
  },
  {
    name: 'filesystem_read',
    riskLevel: 'medium',
    description: 'Can read files from the host filesystem',
    keywords: ['read', 'open', 'load', 'readdir', 'stat', 'exists', 'file', 'directory', 'path'],
  },
  {
    name: 'network_outbound',
    riskLevel: 'high',
    description: 'Can make outbound network requests',
    keywords: ['fetch', 'http', 'https', 'request', 'api', 'axios', 'got', 'node-fetch', 'undici'],
  },
  {
    name: 'websocket',
    riskLevel: 'medium',
    description: 'Can establish WebSocket connections',
    keywords: ['websocket', 'ws', 'sse', 'socket', 'realtime', 'streamable'],
  },
  {
    name: 'database_access',
    riskLevel: 'medium',
    description: 'Can access databases',
    keywords: ['database', 'db', 'sql', 'query', 'postgres', 'mysql', 'sqlite', 'mongo', 'redis'],
  },
  {
    name: 'authentication',
    riskLevel: 'high',
    description: 'Handles authentication credentials',
    keywords: ['auth', 'oauth', 'jwt', 'token', 'credential', 'api-key', 'apikey', 'secret'],
  },
  {
    name: 'encryption',
    riskLevel: 'medium',
    description: 'Performs cryptographic operations',
    keywords: ['encrypt', 'decrypt', 'hash', 'crypto', 'sign', 'verify', 'certificate'],
  },
  {
    name: 'email',
    riskLevel: 'medium',
    description: 'Can send emails',
    keywords: ['email', 'mail', 'smtp', 'send', 'message'],
  },
  {
    name: 'cloud_services',
    riskLevel: 'high',
    description: 'Integrates with cloud services (AWS, GCP, Azure)',
    keywords: ['aws', 'gcp', 'azure', 'cloud', 's3', 'lambda', 'ec2', 'storage'],
  },
  {
    name: 'payment',
    riskLevel: 'critical',
    description: 'Handles payment processing',
    keywords: ['payment', 'stripe', 'paypal', 'billing', 'checkout', 'invoice'],
  },
  {
    name: 'ai_ml',
    riskLevel: 'medium',
    description: 'Uses AI/ML models or APIs',
    keywords: ['openai', 'anthropic', 'llm', 'gpt', 'claude', 'ai', 'machine-learning', 'ml', 'model'],
  },
];

// ── Risk score penalties per capability ──
const RISK_PENALTIES: Record<string, number> = {
  critical: 30,
  high: 15,
  medium: 5,
  low: 0,
};

// ── Classify a package's capabilities ──
export function classifyPackage(
  packageName: string,
  description: string,
  keywords: string[],
): RiskClassification {
  const text = `${description} ${keywords.join(' ')}`.toLowerCase();
  const matchedCapabilities: ToolCapability[] = [];

  for (const capability of CAPABILITY_PATTERNS) {
    const hasMatch = capability.keywords.some((kw) => text.includes(kw));
    if (hasMatch) {
      matchedCapabilities.push(capability);
    }
  }

  // Calculate risk score (100 = safe, 0 = maximum risk)
  let riskScore = 100;
  for (const cap of matchedCapabilities) {
    riskScore -= RISK_PENALTIES[cap.riskLevel];
  }
  riskScore = Math.max(0, Math.min(100, riskScore));

  // Determine overall risk level
  let riskLevel: RiskClassification['riskLevel'] = 'low';
  if (riskScore < 30) riskLevel = 'critical';
  else if (riskScore < 50) riskLevel = 'high';
  else if (riskScore < 70) riskLevel = 'medium';

  // Build summary
  const capNames = matchedCapabilities.map((c) => c.name.replace(/_/g, ' '));
  const summary = matchedCapabilities.length === 0
    ? 'No elevated tool capabilities detected.'
    : `Capabilities detected: ${capNames.join(', ')}. Risk level: ${riskLevel}.`;

  // Build recommendations
  const recommendations: string[] = [];
  const criticalCaps = matchedCapabilities.filter((c) => c.riskLevel === 'critical');
  const highCaps = matchedCapabilities.filter((c) => c.riskLevel === 'high');

  if (criticalCaps.length > 0) {
    recommendations.push('This package has critical capabilities (shell execution, payments). Review thoroughly before use.');
  }
  if (highCaps.length > 0) {
    recommendations.push('This package has elevated capabilities. Ensure proper sandboxing and access controls.');
  }
  if (matchedCapabilities.some((c) => c.name === 'network_outbound')) {
    recommendations.push('Verify that network requests are made only to expected endpoints.');
  }
  if (matchedCapabilities.some((c) => c.name === 'filesystem_write')) {
    recommendations.push('Review file system access patterns to prevent unintended data modification.');
  }
  if (matchedCapabilities.some((c) => c.name === 'authentication')) {
    recommendations.push('Ensure credentials are stored securely and not logged.');
  }

  return {
    packageName,
    capabilities: matchedCapabilities,
    overallRiskScore: riskScore,
    riskLevel,
    summary,
    recommendations,
  };
}

// ── Format risk badge for display ──
export function formatRiskLevel(level: RiskClassification['riskLevel']): string {
  switch (level) {
    case 'critical': return '🔴 Critical';
    case 'high': return '🟠 High';
    case 'medium': return '🟡 Medium';
    case 'low': return '🟢 Low';
  }
}

// ── Get risk color for CSS ──
export function getRiskColor(level: RiskClassification['riskLevel']): string {
  switch (level) {
    case 'critical': return '#ef4444';
    case 'high': return '#f97316';
    case 'medium': return '#eab308';
    case 'low': return '#22c55e';
  }
}
