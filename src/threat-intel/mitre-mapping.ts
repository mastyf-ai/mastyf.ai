export const MITRE_ATTACK_MAP: Record<string, string> = {
  'prompt-injection': 'T1059.004',
  'shell-injection': 'T1059.004',
  'command-injection': 'T1059',
  'ssrf-url': 'T1190',
  'sql-nosql': 'T1190',
  'graphql-injection': 'T1190',
  'credential-exfil': 'T1552',
  'secret-detection': 'T1552.001',
  'path-traversal': 'T1005',
  'file-inclusion': 'T1005',
  'deserialization': 'T1059.003',
  'jwt-manipulation': 'T1606',
  'http-smuggling': 'T1090',
  'polyglot-injection': 'T1059',
  'cross-tool-chain': 'T1071',
  'log-injection': 'T1562.002',
  'zip-slip': 'T1005',
  'dangerous-js': 'T1059.007',
  'boundary-evasion': 'T1027',
  'context-injection': 'T1027.003',
};

export function getMitreTechnique(category: string): string {
  return MITRE_ATTACK_MAP[category] || 'T1071';
}

export function getMitreUrl(category: string): string {
  const technique = getMitreTechnique(category);
  const tid = technique.split('.')[0];
  return `https://attack.mitre.org/techniques/${tid}/`;
}
