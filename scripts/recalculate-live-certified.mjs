#!/usr/bin/env node
/**
 * Mastyf Certified Recalculation Bot
 * Discovers live MCP server packages across npm and triggers live trust score calculation
 * against https://www.mastyf.ai/certified/<pkg>
 */

const BASE_URL = process.env.MASTYF_BASE_URL || 'https://www.mastyf.ai';

async function fetchNpmPackages(query, size = 100) {
  try {
    const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${size}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.objects || []).map((o) => o.package?.name).filter(Boolean);
  } catch (err) {
    console.error(`Failed to search npm for "${query}":`, err.message);
    return [];
  }
}

// Curated high-impact MCP packages + ecosystem servers
const CURATED_MCP_PACKAGES = [
  '@modelcontextprotocol/sdk',
  '@modelcontextprotocol/server-filesystem',
  '@modelcontextprotocol/server-postgres',
  '@modelcontextprotocol/server-sqlite',
  '@modelcontextprotocol/server-memory',
  '@modelcontextprotocol/server-everything',
  '@modelcontextprotocol/server-brave-search',
  '@modelcontextprotocol/server-puppeteer',
  '@modelcontextprotocol/server-slack',
  '@modelcontextprotocol/server-gitlab',
  '@modelcontextprotocol/server-github',
  '@modelcontextprotocol/server-google-maps',
  '@modelcontextprotocol/server-fetch',
  '@modelcontextprotocol/inspector',
  '@modelcontextprotocol/core',
  '@playwright/mcp',
  '@smithery/cli',
  'puppeteer-mcp-server',
  'obsidian-mcp-server',
  'comfyui-mcp',
  'yahoo-finance2',
  'figma-mcp',
  'docker-mcp',
  'agentic-flow',
  '@currents/mcp',
  '@taazkareem/clickup-mcp-server',
  '@cyanheads/mcp-ts-core',
  '@bilig/headless',
  '@aashari/mcp-server-atlassian-jira',
  '@benborla29/mcp-server-mysql',
  '@yawlabs/postgres-mcp',
  'mcp-starter',
  'ifconfig-mcp',
  '@syntrologie/adapt-mcp',
  'mcp-remote',
  'mcp-proxy',
];

async function main() {
  console.log('=== Mastyf Certified Recalculation Bot ===');
  console.log(`Target: ${BASE_URL}`);

  const packageSet = new Set(CURATED_MCP_PACKAGES);

  console.log('Querying npm registry for live MCP servers...');
  const searchQueries = [
    'keywords:mcp-server',
    'keywords:modelcontextprotocol',
    '@modelcontextprotocol',
    'mcp-server',
  ];

  for (const q of searchQueries) {
    const pkgs = await fetchNpmPackages(q, 50);
    pkgs.forEach((p) => packageSet.add(p));
  }

  const allPackages = Array.from(packageSet);
  console.log(`Discovered ${allPackages.length} candidate MCP packages to score.`);

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < allPackages.length; i++) {
    const pkg = allPackages[i];
    const encoded = encodeURIComponent(pkg);
    const targetUrl = `${BASE_URL}/certified/${encoded}`;
    const start = Date.now();

    try {
      const res = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mastyf-Certified-Recalculator/1.0',
          'Accept': 'text/html,application/xhtml+xml',
        },
      });

      const elapsed = Date.now() - start;
      if (res.ok) {
        succeeded++;
        console.log(`[${i + 1}/${allPackages.length}] ✓ ${pkg} (${elapsed}ms) - HTTP ${res.status}`);
      } else {
        failed++;
        console.log(`[${i + 1}/${allPackages.length}] ✗ ${pkg} (${elapsed}ms) - HTTP ${res.status}`);
      }
    } catch (err) {
      failed++;
      console.log(`[${i + 1}/${allPackages.length}] ✗ ${pkg} - Error: ${err.message}`);
    }

    // Small delay between requests to be gentle on external enrichers (OSV / Socket / npm)
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log('\n=== Recalculation Summary ===');
  console.log(`Successfully scored: ${succeeded}`);
  console.log(`Failed / Skipped:    ${failed}`);

  // Check recent scores endpoint
  try {
    const res = await fetch(`${BASE_URL}/api/v1/scores/recent`);
    if (res.ok) {
      const data = await res.json();
      console.log(`Total active certified scores in DB: ${data.total}`);
    }
  } catch (err) {
    console.error('Failed to verify recent scores API:', err.message);
  }
}

main().catch(console.error);
