import { createHash, generateKeyPairSync, createSign, createVerify } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface Receipt {
  action: 'block' | 'pass';
  toolName: string;
  serverName: string;
  rule: string;
  reason: string;
  timestamp: string;
  requestId: string;
  previousReceiptHash: string | null;
}

export interface SignedReceipt extends Receipt {
  signature: string;
  receiptHash: string;
  publicKey: string;
  chainIndex: number;
}

let lastHash: string | null = null;
let chainIndex = 0;
let keyPair: { publicKey: string; privateKey: string } | null = null;

function receiptDir(): string {
  const dir = join(homedir(), '.mastyf-ai', 'receipts');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getKeyPath(): string {
  return join(homedir(), '.mastyf-ai', 'receipt-key.pem');
}

function loadOrGenerateKeys(): { publicKey: string; privateKey: string } {
  if (keyPair) return keyPair;
  const keyPath = getKeyPath();
  if (existsSync(keyPath)) {
    const pem = readFileSync(keyPath, 'utf-8');
    const pubPath = keyPath + '.pub';
    const pubPem = existsSync(pubPath) ? readFileSync(pubPath, 'utf-8') : '';
    keyPair = { privateKey: pem, publicKey: pubPem };
  } else {
    const { publicKey: pub, privateKey: priv } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    writeFileSync(keyPath, priv, 'utf-8');
    writeFileSync(keyPath + '.pub', pub, 'utf-8');
    keyPair = { privateKey: priv, publicKey: pub };
  }
  return keyPair;
}

export function buildReceipt(input: Omit<Receipt, 'previousReceiptHash'>): SignedReceipt {
  const keys = loadOrGenerateKeys();
  const receipt: Receipt = {
    ...input,
    previousReceiptHash: lastHash,
  };

  const receiptJson = JSON.stringify(receipt);
  const receiptHash = createHash('sha256').update(receiptJson).digest('hex');

  const sign = createSign('SHA256');
  sign.update(receiptJson);
  const signature = sign.sign(keys.privateKey, 'base64');

  const signed: SignedReceipt = {
    ...receipt,
    signature,
    receiptHash,
    publicKey: keys.publicKey,
    chainIndex: chainIndex++,
  };

  lastHash = receiptHash;

  const date = new Date().toISOString().slice(0, 10);
  const path = join(receiptDir(), `${date}.jsonl`);
  appendFileSync(path, JSON.stringify(signed) + '\n', 'utf-8');

  return signed;
}

export function verifyReceipt(signed: SignedReceipt): boolean {
  const { signature, publicKey, receiptHash, ...receipt } = signed;
  const receiptJson = JSON.stringify(receipt);

  const computedHash = createHash('sha256').update(receiptJson).digest('hex');
  if (computedHash !== receiptHash) return false;

  const verify = createVerify('SHA256');
  verify.update(receiptJson);
  return verify.verify(publicKey, signature, 'base64');
}

export function verifyChain(fromDate?: string): { valid: boolean; chainLength: number; tampered: boolean } {
  const dir = receiptDir();
  if (!existsSync(dir)) return { valid: true, chainLength: 0, tampered: false };

  const allReceipts: SignedReceipt[] = [];
  const files = readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort();
  for (const file of files) {
    const lines = readFileSync(join(dir, file), 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try { allReceipts.push(JSON.parse(line)); } catch { /* skip corrupt lines */ }
    }
  }

  if (allReceipts.length === 0) return { valid: true, chainLength: 0, tampered: false };

  let prevHash: string | null = null;
  for (const receipt of allReceipts) {
    if (!verifyReceipt(receipt)) return { valid: false, chainLength: allReceipts.length, tampered: true };
    if (prevHash !== null && receipt.previousReceiptHash !== prevHash) {
      return { valid: false, chainLength: allReceipts.length, tampered: true };
    }
    prevHash = receipt.receiptHash;
  }

  return { valid: true, chainLength: allReceipts.length, tampered: false };
}

export function getChainStatus(): { chainLength: number; lastHash: string | null; valid: boolean } {
  const check = verifyChain();
  return { chainLength: check.chainLength, lastHash, valid: check.valid };
}

export function exportReceipts(format: 'jsonl' | 'sigstore'): string {
  const dir = receiptDir();
  if (!existsSync(dir)) return '';
  const all: SignedReceipt[] = [];
  for (const file of readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort()) {
    const lines = readFileSync(join(dir, file), 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try { all.push(JSON.parse(line)); } catch { /* skip corrupt lines */ }
    }
  }
  if (format === 'sigstore') {
    return JSON.stringify(all.map(r => ({ hash: r.receiptHash, signature: r.signature, timestamp: r.timestamp })), null, 2);
  }
  return all.map(r => JSON.stringify(r)).join('\n');
}
