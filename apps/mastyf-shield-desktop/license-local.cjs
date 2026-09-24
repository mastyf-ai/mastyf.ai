/**
 * Offline Shield license: Ed25519-signed token, machine bind, honest expiry.
 * Format: MSH1.<base64url(json)>.<base64url(sig)>
 */
'use strict';

const { createHash, createPublicKey, createPrivateKey, sign, verify } = require('node:crypto');
const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { dirname } = require('node:path');

const PREFIX = 'MSH1';
const OFFLINE_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromB64url(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function machineFingerprint(parts) {
  const raw = [parts.hostname || '', parts.username || '', parts.platform || '', parts.arch || ''].join('|');
  return createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

function parseLicenseToken(token) {
  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    return { ok: false, reason: 'malformed' };
  }
  let payload;
  try {
    payload = JSON.parse(fromB64url(parts[1]).toString('utf8'));
  } catch {
    return { ok: false, reason: 'payload' };
  }
  return { ok: true, payload, sig: fromB64url(parts[2]), body: parts[1] };
}

function looksLikeLemonKey(token) {
  const raw = String(token || '').trim();
  if (!raw || raw.startsWith('MSH1.')) return false;
  if (raw.length < 10 || raw.length > 128) return false;
  return /^[A-Za-z0-9_-]+(-[A-Za-z0-9_-]+)+$/.test(raw) || /^[A-Za-z0-9]{16,}$/.test(raw);
}

function verifyLicenseToken(token, publicPem, nowMs, machineId) {
  const parsed = parseLicenseToken(token);
  if (!parsed.ok) return parsed;
  if (!publicPem) return { ok: false, reason: 'no-public-key' };
  let key;
  try {
    key = createPublicKey(publicPem);
  } catch {
    return { ok: false, reason: 'public-key' };
  }
  const body = Buffer.from(parsed.body, 'utf8');
  let sigOk = false;
  try {
    sigOk = verify(null, body, key, parsed.sig);
  } catch {
    sigOk = false;
  }
  if (!sigOk) return { ok: false, reason: 'signature', payload: parsed.payload };

  const payload = parsed.payload;
  if (payload.v !== 1 || payload.product !== 'shield') {
    return { ok: false, reason: 'product', payload };
  }
  const expMs = Number(payload.exp || 0) * 1000;
  const now = nowMs || Date.now();
  if (!expMs) return { ok: false, reason: 'no-expiry', payload };
  if (now > expMs + OFFLINE_GRACE_MS) {
    return { ok: false, reason: 'expired', payload, expired: true };
  }
  const bound = String(payload.mid || '').trim();
  if (bound && machineId && bound !== machineId) {
    return { ok: false, reason: 'machine-mismatch', payload };
  }
  const grace = now > expMs;
  return {
    ok: true,
    payload,
    grace,
    licensed: true,
    expiresAt: new Date(expMs).toISOString(),
  };
}

function issueLicenseToken(payload, privatePem) {
  const bodyObj = {
    v: 1,
    product: 'shield',
    sub: payload.sub || payload.email || 'customer',
    email: payload.email || payload.sub || '',
    exp: payload.exp,
    iat: payload.iat || Math.floor(Date.now() / 1000),
    seats: payload.seats || 1,
  };
  if (payload.mid) bodyObj.mid = payload.mid;
  const body = b64url(Buffer.from(JSON.stringify(bodyObj), 'utf8'));
  const key = createPrivateKey(privatePem);
  const sig = sign(null, Buffer.from(body, 'utf8'), key);
  return `${PREFIX}.${body}.${b64url(sig)}`;
}

function bindLicenseToMachine(token, publicPem, privatePem, machineId, nowMs) {
  const verified = verifyLicenseToken(token, publicPem, nowMs, '');
  if (!verified.ok) return verified;
  if (verified.payload.mid && verified.payload.mid !== machineId) {
    return { ok: false, reason: 'machine-mismatch', payload: verified.payload };
  }
  if (verified.payload.mid === machineId) {
    return { ok: true, token, alreadyBound: true, payload: verified.payload };
  }
  if (!privatePem) {
    return { ok: true, token, alreadyBound: false, payload: verified.payload, bindDeferred: true };
  }
  const next = issueLicenseToken({ ...verified.payload, mid: machineId }, privatePem);
  return { ok: true, token: next, alreadyBound: false, payload: { ...verified.payload, mid: machineId } };
}

function loadLicenseRecord(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function saveLicenseRecord(filePath, record) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(record, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function readPublicKey(pemOrPath) {
  const raw = String(pemOrPath || '').trim();
  if (!raw) return '';
  if (raw.includes('BEGIN PUBLIC KEY')) return raw;
  if (existsSync(raw)) return readFileSync(raw, 'utf8');
  return '';
}

module.exports = {
  PREFIX,
  OFFLINE_GRACE_MS,
  looksLikeLemonKey,
  machineFingerprint,
  parseLicenseToken,
  verifyLicenseToken,
  issueLicenseToken,
  bindLicenseToMachine,
  loadLicenseRecord,
  saveLicenseRecord,
  readPublicKey,
};
