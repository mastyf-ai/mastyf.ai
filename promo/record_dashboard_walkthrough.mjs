import { chromium } from 'playwright';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const outDir = join(root, 'promo', 'dashboard-walkthrough');
const frameDir = join(outDir, 'frames');
const silentMp4 = join(outDir, 'mastyf-ai-dashboard-walkthrough-silent.mp4');
const voiceText = join(outDir, 'mastyf-ai-dashboard-walkthrough-voiceover.txt');
const voiceAiff = join(outDir, 'mastyf-ai-dashboard-walkthrough-voiceover.aiff');
const finalMp4 = join(outDir, 'mastyf-ai-dashboard-walkthrough-linkedin.mp4');

const baseUrl = process.env.MASTYF_AI_DASHBOARD_URL || 'http://localhost:4000';
const viewport = { width: 1920, height: 1080 };

const script = [
  'Here is a full tour of the Mastyf dot A I dashboard.',
  'The executive dashboard starts with live operational posture: protected traffic, security score, active servers, cost signals, policy state, and compliance readiness.',
  'The Activity workspace begins with the live feed, where teams can watch proxy events and tool activity as agents interact with MCP servers and APIs.',
  'The audit trail sub-tab lets operators filter and inspect individual decisions, including blocked calls, rules, latency, tokens, and cost context.',
  'Analytics turns that activity into trends, while Infrastructure shows the health of the proxy, telemetry, and connected services.',
  'In Security, the posture overview summarizes risk, active threats, server posture, and threat layers.',
  'Threat Detection is where the workflow becomes active: operators can run analysis, launch Threat Lab, and start Auto Threat Research.',
  'The Threat Lab sub-tab reviews generated attack candidates, confidence, provenance, and accept or reject actions for building the corpus.',
  'Auto Research shows the research pipeline, scheduler, generated fixtures, promotion status, and the latest run results.',
  'Threat Intel merges swarm findings and candidate research into a live intelligence feed.',
  'Swarm Analysis runs the autonomous security-swarm job, tracks progress, displays regression gates, findings, plain-English reports, traffic summaries, and logs.',
  'AI Learning shows how the system learns from observed behavior and blocked activity.',
  'Quarantine shows risky rules and patterns that have been isolated for review.',
  'The Policy workspace shows active rules, the policy editor, policy testing, and version history.',
  'In Test and Simulate, teams can run a proposed tool call against the active policy and see the decision result before deploying changes.',
  'The Cost workspace shows spend overview, tool and server breakdowns, and budget controls for agentic workloads.',
  'The MCP Servers workspace shows inventory, health and performance, and certification workflows for observed servers.',
  'The Compliance workspace shows plan posture, continuous assurance, real framework mapping, and generated evidence.',
  'Frameworks maps live policy, audit records, and security scans to SOC 2, ISO 27001, HIPAA, PCI DSS, and FedRAMP.',
  'Evidence generates and downloads full compliance evidence packages from runtime telemetry rather than fabricated data.',
  'Settings covers platform configuration, tenants, integrations, and administration.',
  'Help gives teams the operational guidance they need to deploy and run the platform.',
  'Mastyf dot A I brings runtime protection, threat research, policy enforcement, server trust, cost awareness, and compliance evidence into one dashboard for AI agents and MCP infrastructure.',
].join(' ');

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function prepareDirs() {
  mkdirSync(outDir, { recursive: true });
  if (existsSync(frameDir)) rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });
  for (const file of [silentMp4, voiceAiff, finalMp4]) {
    if (existsSync(file)) rmSync(file, { force: true });
  }
  writeFileSync(voiceText, script.replaceAll('. ', '.\n'), 'utf-8');
}

async function go(page, workspace, view) {
  const url = new URL(baseUrl);
  url.searchParams.set('workspace', workspace);
  if (view) url.searchParams.set('view', view);
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  await page.mouse.move(220, 260, { steps: 18 });
  await page.waitForTimeout(900);
  await page.mouse.move(1380, 520, { steps: 28 });
  await page.waitForTimeout(1800);
}

async function gentleScroll(page) {
  await page.mouse.wheel(0, 620);
  await page.waitForTimeout(800);
  await page.mouse.wheel(0, -420);
  await page.waitForTimeout(600);
}

async function clickButton(page, name, occurrence = 'last', waitMs = 1800) {
  const button = page.getByRole('button', { name: new RegExp(`^${name}$`, 'i') });
  const count = await button.count().catch(() => 0);
  if (count === 0) return false;
  const target = occurrence === 'first' ? button.first() : button.nth(count - 1);
  const box = await target.boundingBox().catch(() => null);
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
    await page.waitForTimeout(500);
  }
  await target.click({ timeout: 3000 }).catch(() => undefined);
  await page.waitForTimeout(waitMs);
  return true;
}

async function clickByText(page, name, waitMs = 1200) {
  const target = page.getByText(name, { exact: true }).first();
  if ((await target.count().catch(() => 0)) === 0) return false;
  const box = await target.boundingBox().catch(() => null);
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 16 });
    await page.waitForTimeout(350);
  }
  await target.click({ timeout: 3000 }).catch(() => undefined);
  await page.waitForTimeout(waitMs);
  return true;
}

async function runPolicySimulation(page) {
  const toolInput = page.getByPlaceholder('read_file');
  if ((await toolInput.count().catch(() => 0)) > 0) {
    await toolInput.first().fill('read_text_file').catch(() => undefined);
  }
  const argInputs = page.locator('input.input');
  const count = await argInputs.count().catch(() => 0);
  if (count > 1) {
    await argInputs.nth(1).fill('{"path":"../../../etc/passwd"}').catch(() => undefined);
  }
  await clickButton(page, 'Run test', 'first', 2200);
}

async function record() {
  prepareDirs();

  const browser = await chromium.launch({
    headless: false,
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--window-size=1920,1080', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport,
  });
  const page = await context.newPage();
  let capturing = true;
  let frame = 0;
  const captureLoop = (async () => {
    while (capturing) {
      const path = join(frameDir, `frame-${String(frame).padStart(5, '0')}.png`);
      frame += 1;
      await page.screenshot({ path, fullPage: false }).catch(() => undefined);
      await page.waitForTimeout(167).catch(() => undefined);
    }
  })();

  await go(page, 'dashboard', undefined);
  await gentleScroll(page);

  await go(page, 'activity', 'realtime');
  await gentleScroll(page);
  await go(page, 'activity', 'audit');
  await clickButton(page, 'Apply', 'first', 900);
  await gentleScroll(page);
  await go(page, 'activity', 'analytics');
  await gentleScroll(page);
  await go(page, 'activity', 'infrastructure');
  await gentleScroll(page);

  await go(page, 'security', 'overview');
  await gentleScroll(page);

  await go(page, 'security', 'threats');
  await clickButton(page, 'Run Analysis', 'last', 2600);
  await clickButton(page, 'Threat Lab', 'last', 2600);
  await clickButton(page, 'Auto Research', 'last', 2600);
  await gentleScroll(page);
  await clickByText(page, 'Threat Lab', 1700);
  await gentleScroll(page);
  await clickByText(page, 'Auto Research', 1700);
  await gentleScroll(page);
  await go(page, 'security', 'intel');
  await gentleScroll(page);

  await go(page, 'security', 'swarm');
  await clickButton(page, 'Run Analysis', 'first', 2600);
  await gentleScroll(page);
  await page.waitForTimeout(1800);
  await go(page, 'security', 'learning');
  await gentleScroll(page);
  await go(page, 'security', 'quarantine');
  await gentleScroll(page);

  await go(page, 'policy', 'rules');
  await gentleScroll(page);
  await go(page, 'policy', 'editor');
  await gentleScroll(page);
  await go(page, 'policy', 'test');
  await runPolicySimulation(page);
  await gentleScroll(page);
  await go(page, 'policy', 'history');
  await gentleScroll(page);

  await go(page, 'cost', 'overview');
  await gentleScroll(page);
  await go(page, 'cost', 'breakdown');
  await gentleScroll(page);
  await go(page, 'cost', 'budgets');
  await gentleScroll(page);

  await go(page, 'servers', 'overview');
  await page.mouse.move(1060, 160, { steps: 22 });
  await page.waitForTimeout(1100);
  await gentleScroll(page);
  await go(page, 'servers', 'health');
  await gentleScroll(page);
  await go(page, 'servers', 'certifications');
  await clickButton(page, 'Resolve version', 'first', 2400);
  await gentleScroll(page);

  await go(page, 'compliance', 'overview');
  await gentleScroll(page);
  await go(page, 'compliance', 'frameworks');
  await gentleScroll(page);

  await go(page, 'compliance', 'evidence');
  await page.waitForTimeout(1200);
  const generateButton = page.getByRole('button', { name: /generate evidence/i });
  if (await generateButton.count()) {
    await generateButton.first().click();
    await page.waitForTimeout(3300);
  }
  await gentleScroll(page);

  await go(page, 'settings', 'general');
  await gentleScroll(page);
  await go(page, 'settings', 'tenants');
  await gentleScroll(page);
  await go(page, 'settings', 'integrations');
  await gentleScroll(page);
  await go(page, 'settings', 'admin');
  await gentleScroll(page);
  await go(page, 'help', undefined);
  await gentleScroll(page);

  await go(page, 'dashboard', undefined);
  await page.waitForTimeout(1800);

  capturing = false;
  await captureLoop;
  await context.close();
  await browser.close();

  const neuralVoice = join(root, 'promo', 'dashboard-walkthrough', 'mastyf-ai-dashboard-walkthrough-neural.mp3');
  const edgeTts = join(root, 'promo', '.venv', 'bin', 'edge-tts');
  if (existsSync(edgeTts)) {
    run(edgeTts, [
      '--voice', 'en-US-AriaNeural',
      '--rate', '+8%',
      '--text', script,
      '--write-media', neuralVoice,
    ]);
  } else {
    run('say', ['-v', 'Ava', '-r', '210', '-f', voiceText, '-o', voiceAiff]);
  }
  run('ffmpeg', [
    '-y',
    '-framerate', '6',
    '-i', join(frameDir, 'frame-%05d.png'),
    '-vf', 'scale=1920:1080,format=yuv420p',
    '-r', '30',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    silentMp4,
  ]);
  run('ffmpeg', [
    '-y',
    '-i', silentMp4,
    '-i', existsSync(neuralVoice) ? neuralVoice : voiceAiff,
    '-filter_complex', '[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=1.18[a]',
    '-map', '0:v',
    '-map', '[a]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '160k',
    finalMp4,
  ]);

  console.log(finalMp4);
}

record().catch((error) => {
  console.error(error);
  process.exit(1);
});
