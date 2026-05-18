import { describe, it, expect } from 'vitest';
import { PayloadNormalizer } from '../../src/utils/payload-normalizer.js';

describe('PayloadNormalizer HTML entities', () => {
  const normalizer = new PayloadNormalizer();

  it('decodes &lt; and &gt; in normalize pipeline', () => {
    const result = normalizer.normalize('cat &lt;/etc/passwd&gt;');
    expect(result.normalized).toContain('<');
    expect(result.normalized).toContain('>');
    expect(result.wasModified).toBe(true);
  });

  it('decodes numeric HTML entities', () => {
    const result = normalizer.normalize('&#60;script&#62;');
    expect(result.normalized).toBe('<script>');
  });
});
