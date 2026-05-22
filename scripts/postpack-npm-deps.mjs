#!/usr/bin/env node
/** Restore package.json after prepack-npm-deps.mjs */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const pkgPath = process.env.PREPACK_PKG ?? join(process.cwd(), 'package.json');
const backupPath = pkgPath + '.prepack-backup';

if (existsSync(backupPath)) {
  writeFileSync(pkgPath, readFileSync(backupPath, 'utf8'));
  unlinkSync(backupPath);
  console.log(`[postpack] restored ${pkgPath}`);
}
