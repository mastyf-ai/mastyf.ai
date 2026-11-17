import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startDetached } from '../src/engine.js';
import { ENGINE } from './fake-runner.js';

describe("the engine's log file", () => {
  it('is never opened if something is already at its path (a planted file or link is not written to)', async () => {
    const logFile = join(mkdtempSync(join(tmpdir(), 'mastyf-log-')), 'engine.log');
    writeFileSync(logFile, 'planted');
    await expect(startDetached({ engine: ENGINE, token: 't'.repeat(43), port: 0, maxBodyMb: 32, mode: 'block', logFile })).rejects.toThrow();
    expect(readFileSync(logFile, 'utf8')).toBe('planted');
  });
});
