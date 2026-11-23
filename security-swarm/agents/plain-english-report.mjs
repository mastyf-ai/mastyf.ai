/**
 * Plain-English report.json for dashboard (template + optional LLM polish).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSwarmDir } from '../lib/swarm-dir.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dir, '..', '..');
const SWARM_DIR = resolveSwarmDir();
const REPORT_PATH = join(SWARM_DIR, 'report.json');

const RULE_GLOSSARY = {
  'request-prompt-injection': 'attempts to override the AI’s instructions in tool arguments',
  'path-traversal': 'path escapes outside allowed directories',
  'secret-leak': 'sensitive credentials in requests or responses',
};

function loadJson(name) {
  const p = join(SWARM_DIR, name);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

function visualsSummaryLine(visuals) {
  if (!visuals) return '';
  if (!visuals.traffic?.hasData && visuals.instantLearning?.source === 'none') return '';
  const parts = [];
  if (visuals.traffic?.hasData) {
    parts.push(
      `${visuals.traffic.totalCalls} proxied calls (${visuals.traffic.totalBlocked} blocked, ${visuals.traffic.windowDays ?? 7}d window)`,
    );
  }
  const il = visuals.instantLearning;
  if (il?.source === 'live' && il.totalEvents > 0) {
    parts.push(`instant learning: ${il.totalEvents} block events, ${il.queuedSuggestions ?? 0} suggestions queued`);
  } else if (il?.source === 'simulated-eval') {
    parts.push('learning charts use simulated eval until live proxy blocks are recorded');
  }
  return parts.length ? parts.join(' · ') : '';
}

function gateSummary(latest) {
  if (!latest?.gates) return { passed: 0, failed: 0, lines: [] };
  const gates = latest.gates;
  const lines = [];
  let passed = 0;
  let failed = 0;
  for (const [k, v] of Object.entries(gates)) {
    const ok = v === true || v?.ok === true;
    if (ok) passed++;
    else failed++;
    lines.push(`${ok ? '✓' : '✗'} ${k.replace(/_/g, ' ')}`);
  }
  return { passed, failed, lines };
}

function buildTemplateReport(ctx) {
  const { latest, traffic, visuals, userServers, live, liveOk, swarmOk } = ctx;
  const gates = gateSummary(latest);
  const regressionPass = swarmOk !== false && (latest?.overall ?? false);
  const trafficBlocks = traffic?.totalBlocked ?? 0;
  const trafficCalls = traffic?.totalCalls ?? 0;
  const userOk = userServers?.summary?.ok ?? 0;
  const userTotal = userServers?.summary?.total ?? 0;

  const verdict =
    regressionPass && (liveOk !== false)
      ? trafficBlocks > 0
        ? 'PASS'
        : 'PASS'
      : 'REVIEW';

  const headline =
    trafficCalls > 0
      ? regressionPass
        ? `Your MCP setup saw ${trafficCalls} proxied calls (${trafficBlocks} blocked). Industry regression gates ${regressionPass ? 'passed' : 'need review'}.`
        : `Your MCP traffic: ${trafficCalls} calls, ${trafficBlocks} blocked. Some regression checks need attention.`
      : regressionPass
        ? 'Regression security gates passed. Use your IDE MCP tools through Mastyf AI to build a personalized traffic report.'
        : 'Security analysis complete — review regression results and connect more MCP traffic for personalization.';

  const plainBullets = [];
  if (trafficCalls > 0) {
    plainBullets.push(`${trafficCalls} tool calls in the last ${traffic?.windowDays ?? 7} days`);
    if (trafficBlocks > 0) {
      plainBullets.push(`${trafficBlocks} calls blocked by policy`);
      const top = traffic.topBlockRules?.[0];
      if (top) {
        plainBullets.push(
          `Most common block: ${top.plainEnglish || top.rule} (${top.count}×)`,
        );
      }
    } else {
      plainBullets.push('No blocks in the window — policy allowed all observed traffic');
    }
  } else {
    plainBullets.push('No proxied traffic recorded yet — wrap servers and use MCP tools in your IDE');
  }

  const serverBullets =
    userTotal > 0
      ? userServers.servers.map((s) => {
          if (s.status === 'ok') {
            return `${s.serverName}: reachable (${s.toolCount} tools)`;
          }
          if (s.status === 'skipped') {
            return `${s.serverName}: skipped (${s.error || 'remote/SSE'})`;
          }
          return `${s.serverName}: probe failed — ${s.error || 'unknown'}`;
        })
      : traffic?.servers?.length
        ? traffic.servers.map(
            (s) =>
              `${s.serverName}: ${s.calls} calls, ${s.blocked} blocked`,
          )
        : ['No wrapped servers in mastyf-ai-configs/ yet'];

  const regressionBullets = [
    `Swarm gates: ${gates.passed} passed, ${gates.failed} failed`,
    live
      ? `Live filesystem MCP: ${live.summary?.scenariosPassed ?? '?'}/${live.summary?.scenariosRun ?? '?'} scenarios`
      : 'Live filesystem regression: not run',
    latest?.overall === false ? 'One or more gate checks failed — see Technical appendix' : 'Core regression gates OK',
  ];

  const actions = [];
  if (!trafficCalls) {
    actions.push({
      priority: 1,
      text: 'Use MCP tools in Cursor/Cline for a few minutes so Mastyf AI can learn your traffic patterns.',
    });
  }
  if (gates.failed > 0) {
    actions.push({
      priority: 1,
      text: 'Open regression gate details below and fix failing checks before production.',
    });
  }
  if (userServers?.summary?.failed > 0) {
    actions.push({
      priority: 2,
      text: `Fix unreachable servers: ${userServers.servers.filter((s) => s.status === 'failed').map((s) => s.serverName).join(', ')}`,
    });
  }
  actions.push({
    priority: 3,
    text: 'Re-run analysis weekly or after adding new MCP servers.',
  });

  const summaryMd = [
    '### What we observed from your usage',
    '',
    ...plainBullets.map((b) => `- ${b}`),
    '',
    '### What we tested',
    '',
    ...regressionBullets.map((b) => `- ${b}`),
    '',
    traffic?.topBlockRules?.length
      ? `**Common block reasons:** ${traffic.topBlockRules
          .slice(0, 3)
          .map((r) => RULE_GLOSSARY[r.rule] || r.plainEnglish || r.rule)
          .join('; ')}.`
      : '',
    visualsSummaryLine(visuals)
      ? `**Infrastructure charts:** ${visualsSummaryLine(visuals)}.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    verdict,
    headline,
    sections: [
      {
        id: 'summary',
        title: 'In plain English',
        markdown: summaryMd,
      },
      {
        id: 'your_servers',
        title: 'Your MCP servers',
        bullets: serverBullets,
      },
      {
        id: 'regression',
        title: 'Industry regression checks',
        bullets: regressionBullets,
      },
      {
        id: 'actions',
        title: 'What to do next',
        items: actions.sort((a, b) => a.priority - b.priority),
      },
    ],
    meta: {
      trafficCalls,
      trafficBlocks,
      regressionPass,
      liveOk,
      swarmOk,
      userServersOk: userOk,
      userServersTotal: userTotal,
    },
  };
}

async function maybePolishWithLlm(report) {
  const key = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!key || process.env.SWARM_REPORT_LLM !== 'true') return report;
  try {
    const { LlmAssistant } = await import('../../dist/ai/llm-assistant.js');
    const assistant = new LlmAssistant({ enabled: true });
    const userPrompt = `Rewrite this MCP security report summary for a solo developer in 2 short paragraphs. Keep facts accurate.\n\n${report.sections[0].markdown}`;
    const resp = await assistant.generate(
      'You are a clear technical writer for solo developers.',
      userPrompt,
    );
    if (resp?.text?.trim()) {
      report.sections[0].markdown = resp.text.trim();
      report.llmPolished = true;
    }
  } catch {
    /* template-only fallback */
  }
  return report;
}

export async function writePlainEnglishReport(opts = {}) {
  mkdirSync(SWARM_DIR, { recursive: true });

  const latest = loadJson('latest.json');
  const traffic = loadJson('traffic-summary.json');
  const visuals = loadJson('visuals-data.json');
  const userServers = loadJson('user-servers-session.json');
  const livePath = join(REPO, 'scenarios', 'real-life', 'output', 'live-filesystem-session.json');
  const live = existsSync(livePath)
    ? JSON.parse(readFileSync(livePath, 'utf-8'))
    : null;

  let report = buildTemplateReport({
    latest,
    traffic,
    visuals,
    userServers,
    live,
    liveOk: opts.liveOk ?? live?.summary?.allPassed,
    swarmOk: opts.swarmOk ?? latest?.overall,
  });

  report = await maybePolishWithLlm(report);
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  return { reportPath: REPORT_PATH, report };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writePlainEnglishReport().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
