#!/usr/bin/env node
/**
 * Create/use adversarial-harness/.venv and install Python deps (PEP 668 safe).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const HARNESS = join(__dir, '..');
const VENV = join(HARNESS, '.venv');
const PY = join(VENV, 'bin', 'python3');
const REQ = join(HARNESS, 'python', 'requirements.txt');

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf-8', ...opts });
}

function systemPythonOk() {
  const check = run('python3', ['-c', 'import yaml; import policy_engine'], {
    env: { ...process.env, PYTHONPATH: join(HARNESS, 'python') },
  });
  return check.status === 0;
}

function venvPythonOk(pythonPath) {
  if (!pythonPath || !existsSync(pythonPath)) return false;
  const check = run(pythonPath, ['-c', 'import yaml'], {
    env: { ...process.env },
  });
  return check.status === 0;
}

function installIntoVenv(pythonPath) {
  const pip = run(pythonPath, ['-m', 'pip', 'install', '-q', '-r', REQ]);
  if (pip.status !== 0) {
    process.stderr.write(`[setup-python-venv] pip install failed: ${pip.stderr || pip.stdout || 'unknown'}\n`);
    return false;
  }
  return venvPythonOk(pythonPath);
}

if (venvPythonOk(PY)) {
  process.stdout.write(PY);
  process.exit(0);
}

if (existsSync(VENV) && !venvPythonOk(PY)) {
  process.stderr.write('[setup-python-venv] existing .venv missing deps — recreating\n');
  rmSync(VENV, { recursive: true, force: true });
}

if (!existsSync(PY)) {
  const v = run('python3', ['-m', 'venv', VENV]);
  if (v.status !== 0) {
    process.stderr.write(
      `[setup-python-venv] venv unavailable (${v.stderr || v.stdout || 'unknown'}); `,
    );
    if (systemPythonOk()) {
      process.stderr.write('using system python3 + PYTHONPATH\n');
      process.stdout.write('python3');
      process.exit(0);
    }
    console.error(v.stderr || v.stdout);
    process.exit(1);
  }
}

if (!installIntoVenv(PY)) {
  if (systemPythonOk()) {
    process.stderr.write('[setup-python-venv] venv install failed; using system python3 + PYTHONPATH\n');
    process.stdout.write('python3');
    process.exit(0);
  }
  process.exit(1);
}

process.stdout.write(PY);
