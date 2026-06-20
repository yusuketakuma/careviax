import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('vitest coverage config', () => {
  it('keeps shared library code inside the coverage gate', () => {
    const config = readFileSync('vitest.config.ts', 'utf8');

    expect(config).toContain("'src/lib/**/*.ts'");
  });
});
