import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

describe('manifest', () => {
  it("no setting can be changed by a repository's own settings", () => {
    const props = manifest.contributes.configuration.properties as Record<string, { scope?: string }>;
    for (const [name, prop] of Object.entries(props)) expect({ name, scope: prop.scope }).toEqual({ name, scope: 'machine' });
  });
});
