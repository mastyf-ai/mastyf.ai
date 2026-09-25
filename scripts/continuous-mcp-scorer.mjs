#!/usr/bin/env node
/**
 * Continuous Real-Time MCP Server Discovery & Scoring Engine Daemon v3
 * 
 * • Multi-axis deep npm & ecosystem discovery
 * • Uses updated bug-free vulnerability attribution (affects parameter + strict package verification)
 * • Evaluates packages into true, rich, differentiated scores (Grades A+, A, B, C, D, F)
 * • Continuously cycles through discovered packages and refreshes them in real time
 */

const BASE_URL = process.env.MASTYF_BASE_URL || 'https://www.mastyf.ai';
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '8', 10);
const PAGE_SIZE = 250;

const SEARCH_QUERIES = [
  'keywords:mcp-server',
  'keywords:modelcontextprotocol',
  '@modelcontextprotocol',
  'mcp-server',
  'keywords:mcp',
  'modelcontextprotocol',
  'mcp-tools',
  'mcp-client',
  'mcp-agent',
  'model-context-protocol',
];

const candidateQueue = [];
const enqueuedSet = new Set();

let totalScoredSession = 0;
let totalFailedSession = 0;

function isLikelyMcpPackage(pkg) {
  if (!pkg || !pkg.name) return false;
  const name = pkg.name.toLowerCase();
  const desc = (pkg.description || '').toLowerCase();
  const keywords = Array.isArray(pkg.keywords) ? pkg.keywords.map((k) => String(k).toLowerCase()) : [];

  if (name.includes('mcp') || name.includes('modelcontextprotocol')) return true;
  if (keywords.some((k) => k === 'mcp' || k === 'mcp-server' || k === 'modelcontextprotocol')) return true;
  if (desc.includes('model context protocol') || desc.includes('mcp server') || desc.includes('mcp client')) return true;
  return false;
}

async function fetchNpmPage(query, from = 0, size = PAGE_SIZE) {
  try {
    const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${size}&from=${from}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mastyf-Continuous-Bot/3.0' } });
    if (!res.ok) return { total: 0, objects: [] };
    return await res.json();
  } catch (err) {
    console.error(`[Search Error] ${query} (from ${from}): ${err.message}`);
    return { total: 0, objects: [] };
  }
}

async function discoverBatch() {
  console.log(`[Discovery] Scanning npm registry across ${SEARCH_QUERIES.length} search axes...`);
  let newAdded = 0;

  for (const query of SEARCH_QUERIES) {
    let from = 0;
    const maxPages = 20; // Scan up to 5,000 packages per query per pass

    for (let page = 0; page < maxPages; page++) {
      const data = await fetchNpmPage(query, from, PAGE_SIZE);
      const objects = data.objects || [];
      if (objects.length === 0) break;

      for (const obj of objects) {
        const pkg = obj.package;
        if (pkg && isLikelyMcpPackage(pkg)) {
          if (!enqueuedSet.has(pkg.name)) {
            enqueuedSet.add(pkg.name);
            candidateQueue.push(pkg.name);
            newAdded++;
          }
        }
      }

      from += PAGE_SIZE;
      if (from >= (data.total || 0)) break;
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  console.log(`[Discovery] Enqueued ${newAdded} packages. Current queue length: ${candidateQueue.length}`);
}

async function scorePackage(packageName) {
  const encoded = encodeURIComponent(packageName);
  const targetUrl = `${BASE_URL}/certified/${encoded}`;
  const start = Date.now();

  try {
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mastyf-Continuous-Bot/3.0',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    const elapsed = Date.now() - start;
    if (res.ok) {
      totalScoredSession++;
      console.log(`[✓ Scored] ${packageName.padEnd(45)} (${elapsed}ms) [Queue: ${candidateQueue.length} | Scored: ${totalScoredSession}]`);
      return true;
    } else {
      totalFailedSession++;
      console.log(`[✗ Failed] ${packageName.padEnd(45)} HTTP ${res.status} (${elapsed}ms)`);
      return false;
    }
  } catch (err) {
    totalFailedSession++;
    console.log(`[✗ Error]  ${packageName.padEnd(45)} ${err.message}`);
    return false;
  }
}

async function worker(id) {
  while (true) {
    const nextPkg = candidateQueue.shift();
    if (nextPkg) {
      enqueuedSet.delete(nextPkg);
      await scorePackage(nextPkg);
      await new Promise((r) => setTimeout(r, 120));
    } else {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function main() {
  console.log('=====================================================');
  console.log(' Mastyf Continuous Real-Time MCP Scorer Daemon v3');
  console.log(` Target Base URL: ${BASE_URL}`);
  console.log(` Concurrency:     ${CONCURRENCY} workers`);
  console.log('=====================================================\n');

  // Initial discovery pass
  await discoverBatch();

  // Launch workers
  console.log(`[Workers] Launching ${CONCURRENCY} concurrent scoring workers...`);
  for (let i = 0; i < CONCURRENCY; i++) {
    worker(i + 1);
  }

  // Continuous discovery pass every 3 minutes
  setInterval(async () => {
    try {
      await discoverBatch();
    } catch (e) {
      console.error('[Discovery Interval Error]', e.message);
    }
  }, 3 * 60 * 1000);

  // Status heartbeat every 30 seconds
  setInterval(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/v1/scores/recent?limit=1`);
      if (res.ok) {
        const data = await res.json();
        console.log(`[Heartbeat] Live Certified Packages in DB: ${data.total} | Queue: ${candidateQueue.length} | Scored This Session: ${totalScoredSession}`);
      }
    } catch (e) {
      /* ignore */
    }
  }, 30 * 1000);
}

main().catch((err) => {
  console.error('[Fatal]', err);
  process.exit(1);
});
