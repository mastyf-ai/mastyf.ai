/**
 * Vuln Analyst — multi-pass LLM in-depth text analysis for novel/unpublished findings.
 *
 * Patterned after mcp-health-report (citations-only) + incident-investigator.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  appendFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { Logger } from '../utils/logger.js';
import { LlmAssistant } from '../ai/llm-assistant.js';
import { getFinding, updateFindingStatus } from './store.js';
import { sliceGraphAround, buildAgentStackGraph } from './stack-graph.js';
import { ensureVulnStoreDir, vulnReportsDir } from './paths.js';
import type {
  VulnAnalysisReport,
  VulnAnalysisSections,
  VulnContextPack,
  VulnFinding,
  VulnSeverity,
} from './types.js';

function reportsDir(): string {
  return vulnReportsDir();
}

function ensureReportsDir(): void {
  ensureVulnStoreDir();
  if (!existsSync(reportsDir())) mkdirSync(reportsDir(), { recursive: true });
}

function evidenceHash(finding: VulnFinding): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: finding.id,
        evidence: finding.evidence,
        status: finding.status,
        severity: finding.severity,
      }),
    )
    .digest('hex')
    .slice(0, 16);
}

function minSeverityOk(finding: VulnFinding): boolean {
  const min = (process.env.MASTYF_AI_VULN_ANALYSIS_MIN_SEVERITY || 'MEDIUM').toUpperCase();
  const order: VulnSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
  return order.indexOf(finding.severity) <= order.indexOf(min as VulnSeverity);
}

export function isVulnAnalysisEnabled(): boolean {
  if (process.env.MASTYF_AI_VULN_ANALYSIS_ENABLED === 'false') return false;
  if (process.env.MASTYF_AI_VULN_DISCOVERY_ENABLED === 'true') return true;
  return process.env.MASTYF_AI_VULN_ANALYSIS_ENABLED === 'true';
}

export function buildContextPack(finding: VulnFinding): VulnContextPack {
  const graph = buildAgentStackGraph([]);
  const slice = sliceGraphAround(graph, finding.target.name);
  return {
    finding,
    stackGraph: slice.nodes.length ? slice : undefined,
    reproArtifacts: {
      request: finding.evidence.request,
      response: finding.evidence.response,
      proxyDecision: finding.evidence.proxyDecision,
      rule: finding.evidence.rule,
    },
    scannerOutput: [
      `scanner=${finding.evidence.scanner}`,
      ...(finding.evidence.stackTrace ? [finding.evidence.stackTrace] : []),
      ...finding.evidence.reproSteps,
    ],
    publishedIntel: finding.relatedCve
      ? [{ id: finding.relatedCve, summary: finding.description }]
      : [{ id: 'none', summary: 'No published CVE linked in finding evidence' }],
    policyContext: finding.evidence.rule ? [`rule=${finding.evidence.rule}`] : [],
  };
}

function citationsFromPack(pack: VulnContextPack): VulnAnalysisReport['citations'] {
  const citations: VulnAnalysisReport['citations'] = [
    {
      id: `finding:${pack.finding.id}`,
      kind: 'finding',
      excerpt: pack.finding.title,
    },
  ];
  pack.finding.evidence.reproSteps.forEach((step, i) => {
    citations.push({ id: `repro:${i + 1}`, kind: 'repro', excerpt: step.slice(0, 200) });
  });
  for (const s of pack.scannerOutput || []) {
    citations.push({
      id: `scan:${citations.length}`,
      kind: 'scanner',
      excerpt: s.slice(0, 200),
    });
  }
  for (const p of pack.publishedIntel || []) {
    citations.push({ id: `intel:${p.id}`, kind: 'intel', excerpt: p.summary.slice(0, 200) });
  }
  return citations;
}

function formatFactsCorpus(pack: VulnContextPack): string {
  const cites = citationsFromPack(pack);
  return cites.map((c) => `[${c.id}] ${c.excerpt}`).join('\n');
}

function emptySections(): VulnAnalysisSections {
  return {
    executiveSummary: '',
    technicalDeepDive: '',
    exploitScenario: '',
    impactAssessment: '',
    affectedComponents: '',
    evidenceAndRepro: '',
    similarPublishedCves: '',
    estimatedSeverity: '',
    mitigations: '',
    mastyfRecommendations: '',
    disclosureGuidance: '',
  };
}

function templateReport(finding: VulnFinding, pack: VulnContextPack): VulnAnalysisReport {
  const sections: VulnAnalysisSections = {
    executiveSummary:
      `Mastyf.ai detected a ${finding.severity} ${finding.class} issue on ` +
      `${finding.target.kind} "${finding.target.name}". Status: ${finding.status}. ` +
      `This is a template report (LLM unavailable). Review evidence before acting.`,
    technicalDeepDive:
      `${finding.description}\n\nScanner: ${finding.evidence.scanner}\n` +
      (finding.evidence.stackTrace || 'No stack trace.'),
    exploitScenario: finding.evidence.reproSteps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    impactAssessment: `Severity ${finding.severity}. Exploitability: preAuth=${finding.exploitability.preAuth}, network=${finding.exploitability.networkReachable}.`,
    affectedComponents: `${finding.target.kind}: ${finding.target.name}` +
      (finding.target.version ? `@${finding.target.version}` : '') +
      (finding.target.url ? ` (${finding.target.url})` : ''),
    evidenceAndRepro: finding.evidence.reproSteps.join('\n'),
    similarPublishedCves: finding.relatedCve
      ? `Linked identifier: ${finding.relatedCve}`
      : 'No published CVE linked — treat as pre-advisory / unpublished.',
    estimatedSeverity: `${finding.severity} (from scanner classification; non-official)`,
    mitigations: 'Review and patch affected component; add mastyf policy deny/argPatterns as appropriate.',
    mastyfRecommendations:
      'Open Threat Lab with this finding; consider response-injection scanner and corpus fixture if applicable.',
    disclosureGuidance:
      'If validated, prepare vendor report with repro steps. Do not invent CVE IDs.',
  };
  const fullText = renderMarkdown(finding, sections, citationsFromPack(pack));
  return {
    id: `analysis-${finding.id}-${evidenceHash(finding)}`,
    findingId: finding.id,
    generatedAt: new Date().toISOString(),
    status: 'draft',
    provider: 'none',
    model: 'template',
    format: 'markdown',
    sections,
    fullText,
    citations: citationsFromPack(pack),
    confidence: 0.4,
    source: 'template-fallback',
  };
}

function renderMarkdown(
  finding: VulnFinding,
  sections: VulnAnalysisSections,
  citations: VulnAnalysisReport['citations'],
): string {
  const lines = [
    `# Vulnerability Analysis: ${finding.id}`,
    `> Status: ${finding.status} | Severity: ${finding.severity} | Class: ${finding.class}`,
    `> Target: ${finding.target.kind}/${finding.target.name}` +
      (finding.target.version ? ` @ ${finding.target.version}` : ''),
    `> Generated: ${new Date().toISOString()}`,
    '',
    '## Executive Summary',
    sections.executiveSummary,
    '',
    '## Technical Deep Dive',
    sections.technicalDeepDive,
    '',
    '## Exploit Scenario (Agent Stack)',
    sections.exploitScenario,
    '',
    '## Impact Assessment',
    sections.impactAssessment,
    '',
    '## Affected Components',
    sections.affectedComponents,
    '',
    '## Evidence and Reproduction',
    sections.evidenceAndRepro,
    '',
    '## Comparison to Published CVEs',
    sections.similarPublishedCves,
    '',
    '## Estimated Severity (non-official)',
    sections.estimatedSeverity,
    '',
    '## Recommended Mitigations',
    sections.mitigations,
    '',
    '## Mastyf.ai Recommendations',
    sections.mastyfRecommendations,
    '',
    '## Disclosure Guidance',
    sections.disclosureGuidance,
    '',
    '## Citations',
    ...citations.map((c) => `- [${c.id}] ${c.excerpt}`),
    '',
  ];
  return lines.join('\n');
}

function validateFactBullets(facts: string, citeIds: Set<string>): boolean {
  const lines = facts.split('\n').filter((l) => l.trim().startsWith('-') || l.trim().startsWith('*'));
  if (!lines.length) return false;
  let ok = 0;
  for (const line of lines) {
    const m = line.match(/\[([^\]]+)\]/);
    if (m && citeIds.has(m[1])) ok++;
  }
  return ok >= Math.ceil(lines.length * 0.5);
}

function rejectFabricatedCves(text: string, allowed: Set<string>): string {
  return text.replace(/CVE-\d{4}-\d+/gi, (id) => {
    if (allowed.has(id.toUpperCase()) || allowed.has(id)) return id;
    return `${id} [UNVERIFIED—removed]`;
  });
}

async function llmGenerate(
  system: string,
  user: string,
  llm?: LlmAssistant,
): Promise<{ text: string; model: string } | null> {
  const assistant =
    llm
    || new LlmAssistant({
      hotPath: false,
      timeoutMs: parseInt(process.env.MASTYF_AI_VULN_ANALYSIS_TIMEOUT_MS || '120000', 10),
      maxTokens: parseInt(process.env.MASTYF_AI_VULN_ANALYSIS_MAX_TOKENS || '2048', 10),
    });
  if (!assistant.isAvailable()) return null;
  const healthy = await assistant.healthCheck();
  if (!healthy) return null;
  try {
    const result = await assistant.generate(system, user);
    if (!result?.text?.trim()) return null;
    return { text: result.text.trim(), model: result.model };
  } catch (err) {
    Logger.warn(`[vuln-analyst] LLM error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Template fallback is opt-in only — LLM is mandatory by default. */
export function allowVulnAnalysisTemplateFallback(): boolean {
  return process.env.MASTYF_AI_VULN_ANALYSIS_ALLOW_TEMPLATE === 'true';
}

/** Ensure LLM is enabled when unset (VDE analysis requires it by default). */
export function ensureVulnAnalysisLlmEnabled(): void {
  if (process.env.MASTYF_AI_LLM_ENABLED === undefined) {
    process.env.MASTYF_AI_LLM_ENABLED = 'true';
  }
}

export class VulnAnalysisLlmUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VulnAnalysisLlmUnavailableError';
  }
}

async function requireLlmAssistant(): Promise<LlmAssistant> {
  ensureVulnAnalysisLlmEnabled();
  if (process.env.MASTYF_AI_LLM_ENABLED === 'false') {
    throw new VulnAnalysisLlmUnavailableError(
      'LLM is required for Vuln Discovery deep analysis (MASTYF_AI_LLM_ENABLED=false). '
        + 'Set MASTYF_AI_LLM_ENABLED=true, or set MASTYF_AI_VULN_ANALYSIS_ALLOW_TEMPLATE=true for offline templates.',
    );
  }
  const model =
    process.env.MASTYF_AI_VULN_ANALYSIS_MODEL
    || process.env.MASTYF_AI_LLM_MODEL
    || 'qwen3:8b';
  const llm = new LlmAssistant({
    hotPath: false,
    model,
    timeoutMs: parseInt(process.env.MASTYF_AI_VULN_ANALYSIS_TIMEOUT_MS || '120000', 10),
    maxTokens: parseInt(process.env.MASTYF_AI_VULN_ANALYSIS_MAX_TOKENS || '2048', 10),
  });
  if (!llm.isAvailable()) {
    throw new VulnAnalysisLlmUnavailableError(
      'LLM is required but disabled in config. Set MASTYF_AI_LLM_ENABLED=true.',
    );
  }
  const health = await llm.healthCheckDetailed();
  if (!health.ok) {
    throw new VulnAnalysisLlmUnavailableError(
      `LLM is required for Vuln Discovery analysis but unavailable at ${health.endpoint}`
        + `${health.reason ? ` (${health.reason})` : ''}. `
        + `Start Ollama (ollama serve) and pull model "${model}", `
        + 'or set MASTYF_AI_VULN_ANALYSIS_ALLOW_TEMPLATE=true for offline template reports.',
    );
  }
  return llm;
}

function auditAnalysis(event: Record<string, unknown>): void {
  const dir = ensureVulnStoreDir();
  appendFileSync(
    join(dir, 'vuln-analysis-audit.jsonl'),
    JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n',
  );
}

export function saveReport(report: VulnAnalysisReport): string {
  ensureReportsDir();
  const mdPath = join(reportsDir(), `${report.findingId}.md`);
  const jsonPath = join(reportsDir(), `${report.findingId}.json`);
  const txtPath = join(reportsDir(), `${report.findingId}.txt`);
  writeFileSync(mdPath, report.fullText);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(txtPath, report.fullText.replace(/^#+\s*/gm, '').replace(/^>\s*/gm, ''));
  return mdPath;
}

export function loadReport(findingId: string): VulnAnalysisReport | null {
  const jsonPath = join(reportsDir(), `${findingId}.json`);
  if (!existsSync(jsonPath)) return null;
  try {
    return JSON.parse(readFileSync(jsonPath, 'utf-8')) as VulnAnalysisReport;
  } catch {
    return null;
  }
}

/** Promote analysis report draft → final (human approve). */
export function approveAnalysisReport(findingId: string): VulnAnalysisReport | null {
  const report = loadReport(findingId);
  if (!report) return null;
  const next: VulnAnalysisReport = {
    ...report,
    status: 'final',
    generatedAt: report.generatedAt,
  };
  saveReport(next);
  auditAnalysis({
    findingId,
    reportId: report.id,
    source: 'approve-analysis',
    status: 'final',
  });
  return next;
}

/**
 * Multi-pass LLM analysis. LLM is mandatory by default; template only when
 * MASTYF_AI_VULN_ANALYSIS_ALLOW_TEMPLATE=true.
 */
export async function analyzeFinding(
  findingId: string,
  opts?: { force?: boolean; passes?: number },
): Promise<VulnAnalysisReport | null> {
  if (!isVulnAnalysisEnabled() && !opts?.force) {
    Logger.warn('[vuln-analyst] Analysis disabled');
    return null;
  }

  const finding = getFinding(findingId);
  if (!finding) return null;
  if (!minSeverityOk(finding) && !opts?.force) {
    Logger.info(`[vuln-analyst] Skipping ${findingId} — below min severity`);
    return null;
  }

  const pack = buildContextPack(finding);
  const existing = loadReport(findingId);
  if (
    existing
    && existing.id.endsWith(evidenceHash(finding))
    && !opts?.force
    && (existing.source === 'llm' || allowVulnAnalysisTemplateFallback())
  ) {
    return existing;
  }
  // Stale template caches are not reused when LLM is required
  if (
    existing
    && existing.source === 'template-fallback'
    && !allowVulnAnalysisTemplateFallback()
    && !opts?.force
  ) {
    Logger.info(`[vuln-analyst] Ignoring cached template for ${findingId} — regenerating with LLM`);
  }

  const citeIds = new Set(citationsFromPack(pack).map((c) => c.id));
  const allowedCves = new Set(
    [...(pack.publishedIntel || [])]
      .map((p) => p.id.toUpperCase())
      .filter((id) => id.startsWith('CVE-')),
  );
  if (finding.relatedCve) allowedCves.add(finding.relatedCve.toUpperCase());

  const corpus = formatFactsCorpus(pack);
  const passes = Math.max(
    1,
    opts?.passes
      ?? parseInt(process.env.MASTYF_AI_VULN_ANALYSIS_PASSES || '2', 10),
  );
  const requireCitations = process.env.MASTYF_AI_VULN_ANALYSIS_REQUIRE_CITATIONS !== 'false';

  let llm: LlmAssistant | undefined;
  if (!allowVulnAnalysisTemplateFallback()) {
    llm = await requireLlmAssistant();
  } else {
    ensureVulnAnalysisLlmEnabled();
    try {
      llm = await requireLlmAssistant();
    } catch {
      llm = undefined;
    }
  }

  // Pass 1 — facts only
  let facts = '';
  let model = 'template';
  let provider = 'none';

  if (passes >= 1) {
    const pass1 = await llmGenerate(
      'You extract security finding facts. List ONLY facts present in citations. ' +
        'Each bullet MUST include a [citation-id]. No inference. No new CVE IDs.',
      `Citations:\n${corpus}\n\nList fact bullets:`,
      llm,
    );
    if (pass1) {
      facts = pass1.text;
      model = pass1.model;
      provider = 'ollama';
      if (requireCitations && !validateFactBullets(facts, citeIds)) {
        Logger.warn('[vuln-analyst] Pass1 citation validation failed — using citation corpus as facts');
        facts = corpus
          .split('\n')
          .map((l) => `- ${l}`)
          .join('\n');
      }
    }
  }

  if (!facts) {
    if (!allowVulnAnalysisTemplateFallback()) {
      throw new VulnAnalysisLlmUnavailableError(
        'LLM is required for Vuln Discovery deep analysis but returned no usable output. '
          + 'Check Ollama is running and the configured model is pulled, '
          + 'or set MASTYF_AI_VULN_ANALYSIS_ALLOW_TEMPLATE=true for offline templates.',
      );
    }
    const report = templateReport(finding, pack);
    saveReport(report);
    updateFindingStatus(findingId, finding.status, { analysisReportId: report.id });
    auditAnalysis({ findingId, source: 'template-fallback', model: 'template' });
    return report;
  }

  const sections = emptySections();

  // Pass 2 — deep analysis
  if (passes >= 2) {
    const pass2 = await llmGenerate(
      'You are a senior security researcher writing an in-depth vulnerability analysis for an MCP/AI agent stack. ' +
        'Use ONLY the provided facts. Write clear technical prose for these sections as markdown headings:\n' +
        '## Technical Deep Dive\n## Exploit Scenario\n## Impact Assessment\n## Affected Components\n' +
        '## Evidence and Reproduction\n## Comparison to Published CVEs\n## Estimated Severity\n' +
        'Do not invent CVE IDs not in facts. Mark unpublished findings clearly. '
        + 'If the evidence shows Access denied / soft-deny / args-echo only, say it is NOT a confirmed exploit. '
        + 'Do not claim RCE, data exfiltration, or privilege escalation without quoting proof from the facts.',
      `Finding: ${finding.title}\nClass: ${finding.class}\nSeverity: ${finding.severity}\n\nFacts:\n${facts}\n\nWrite the sections:`,
      llm,
    );
    if (pass2) {
      model = pass2.model;
      const text = rejectFabricatedCves(pass2.text, allowedCves);
      sections.technicalDeepDive = extractSection(text, 'Technical Deep Dive') || text;
      sections.exploitScenario = extractSection(text, 'Exploit Scenario') || '';
      sections.impactAssessment = extractSection(text, 'Impact Assessment') || '';
      sections.affectedComponents = extractSection(text, 'Affected Components') || '';
      sections.evidenceAndRepro = extractSection(text, 'Evidence and Reproduction') || facts;
      sections.similarPublishedCves =
        extractSection(text, 'Comparison to Published CVEs') ||
        (finding.relatedCve ? `Linked: ${finding.relatedCve}` : 'No published CVE in evidence.');
      sections.estimatedSeverity =
        extractSection(text, 'Estimated Severity') || finding.severity;
    }
  }

  // Pass 3 — mitigations
  if (passes >= 3) {
    const pass3 = await llmGenerate(
      'You recommend mitigations for MCP/AI proxy security (mastyf.ai). ' +
        'Write sections:\n## Recommended Mitigations\n## Mastyf.ai Recommendations\n## Disclosure Guidance\n' +
        'Be specific about policy rules, response scanning, and vendor disclosure. No invented CVE IDs.',
      `Finding: ${finding.title}\nFacts:\n${facts}\nDeep dive:\n${sections.technicalDeepDive.slice(0, 2000)}\n\nWrite mitigations:`,
      llm,
    );
    if (pass3) {
      const text = rejectFabricatedCves(pass3.text, allowedCves);
      sections.mitigations = extractSection(text, 'Recommended Mitigations') || text;
      sections.mastyfRecommendations = extractSection(text, 'Mastyf.ai Recommendations') || '';
      sections.disclosureGuidance = extractSection(text, 'Disclosure Guidance') || '';
    }
  }

  // Executive summary last
  const exec = await llmGenerate(
    'Explain this vulnerability to a non-technical operator in 2-3 short paragraphs. Use only cited facts. No jargon dump.',
    `Title: ${finding.title}\nSeverity: ${finding.severity}\nFacts:\n${facts}\n\nExecutive summary:`,
    llm,
  );
  sections.executiveSummary =
    exec?.text ||
    `A ${finding.severity} ${finding.class} issue was found on ${finding.target.name}. See technical sections for details.`;

  // Fill empties from structured evidence (not marketed as LLM template)
  const fallback = templateReport(finding, pack).sections;
  for (const key of Object.keys(sections) as (keyof VulnAnalysisSections)[]) {
    if (!sections[key]?.trim()) sections[key] = fallback[key];
  }

  const report: VulnAnalysisReport = {
    id: `analysis-${finding.id}-${evidenceHash(finding)}`,
    findingId: finding.id,
    generatedAt: new Date().toISOString(),
    status: 'draft',
    provider,
    model,
    format: 'markdown',
    sections,
    fullText: renderMarkdown(finding, sections, citationsFromPack(pack)),
    citations: citationsFromPack(pack),
    confidence: provider === 'ollama' ? 0.75 : 0.4,
    source: provider === 'ollama' ? 'llm' : 'template-fallback',
  };

  if (report.source !== 'llm' && !allowVulnAnalysisTemplateFallback()) {
    throw new VulnAnalysisLlmUnavailableError(
      'LLM is required for Vuln Discovery analysis but the report was not produced by the LLM. '
        + 'Check Ollama health and model availability.',
    );
  }

  saveReport(report);
  updateFindingStatus(findingId, finding.status, { analysisReportId: report.id });
  auditAnalysis({
    findingId,
    reportId: report.id,
    model,
    provider,
    source: report.source,
    promptHash: createHash('sha256').update(facts).digest('hex').slice(0, 12),
  });
  return report;
}

function extractSection(text: string, heading: string): string {
  const re = new RegExp(
    `##\\s*${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
    'i',
  );
  const m = text.match(re);
  return m?.[1]?.trim() || '';
}

export async function analyzeAll(opts?: {
  minSeverity?: VulnSeverity;
  status?: 'validated' | 'candidate';
}): Promise<VulnAnalysisReport[]> {
  const { listFindings } = await import('./store.js');
  const findings = listFindings({
    status: opts?.status || 'validated',
    minSeverity: opts?.minSeverity || 'HIGH',
  });
  const reports: VulnAnalysisReport[] = [];
  for (const f of findings) {
    const r = await analyzeFinding(f.id);
    if (r) reports.push(r);
  }
  return reports;
}

/** Called when finding is validated — auto-analyze if configured. */
export async function onFindingValidated(findingId: string): Promise<VulnAnalysisReport | null> {
  if (process.env.MASTYF_AI_VULN_ANALYSIS_AUTO_ON_VALIDATE === 'false') return null;
  return analyzeFinding(findingId);
}
