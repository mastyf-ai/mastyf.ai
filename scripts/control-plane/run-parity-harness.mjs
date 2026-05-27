#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';

const LEGACY_PROXY_URL = process.env.LEGACY_PROXY_URL || 'http://localhost:4000';
const DATA_PLANE_URL = process.env.DATA_PLANE_URL || 'http://localhost:9091';
const PARITY_PATH = process.env.PARITY_PATH || '/';
const FIXTURE_PATH = process.env.PARITY_FIXTURES_PATH
  || path.resolve(process.cwd(), 'tests/fixtures/control-plane-parity-fixtures.json');

const fixtures = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));
if (!Array.isArray(fixtures) || fixtures.length < 20 || fixtures.length > 50) {
  throw new Error('Parity harness requires 20-50 fixtures');
}

function toPayload(fx) {
  return {
    jsonrpc: '2.0',
    id: fx.id,
    method: fx.method || 'tools/call',
    params: {
      name: fx.toolName,
      arguments: fx.arguments || {},
    },
  };
}

function extractBlocked(responseBody, statusCode) {
  if (statusCode >= 400) return true;
  if (!responseBody || typeof responseBody !== 'object') return false;
  const message = String(responseBody?.error?.message || '');
  return /blocked|denied/i.test(message);
}

async function runTarget(baseUrl, payload) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}${PARITY_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return {
    status: res.status,
    blocked: extractBlocked(body, res.status),
    body,
  };
}

async function assertReachable(baseUrl) {
  const healthUrl = `${baseUrl.replace(/\/$/, '')}/healthz`;
  let res;
  try {
    res = await fetch(healthUrl);
  } catch (error) {
    throw new Error(`Cannot reach ${healthUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!res.ok) {
    const rootUrl = `${baseUrl.replace(/\/$/, '')}/`;
    const root = await fetch(rootUrl);
    if (!root.ok && root.status < 500) {
      return;
    }
    if (root.ok) return;
    throw new Error(`Healthcheck failed for ${healthUrl} (status ${res.status})`);
  }
}

async function main() {
  await Promise.all([
    assertReachable(LEGACY_PROXY_URL),
    assertReachable(DATA_PLANE_URL),
  ]);

  const mismatches = [];
  let compared = 0;

  for (const fx of fixtures) {
    const payload = toPayload(fx);
    const [legacy, dataPlane] = await Promise.all([
      runTarget(LEGACY_PROXY_URL, payload),
      runTarget(DATA_PLANE_URL, payload),
    ]);
    compared += 1;
    if (legacy.blocked !== dataPlane.blocked) {
      mismatches.push({
        id: fx.id,
        toolName: fx.toolName,
        legacyBlocked: legacy.blocked,
        dataPlaneBlocked: dataPlane.blocked,
        legacyStatus: legacy.status,
        dataPlaneStatus: dataPlane.status,
      });
    }
  }

  const summary = {
    fixtures: fixtures.length,
    compared,
    mismatches: mismatches.length,
    legacyProxy: LEGACY_PROXY_URL,
    dataPlane: DATA_PLANE_URL,
  };

  if (mismatches.length > 0) {
    console.error(JSON.stringify({ summary, mismatches }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({ summary }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
