import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('vitest coverage config', () => {
  it('keeps shared library code inside the coverage gate', () => {
    const config = readFileSync('vitest.config.ts', 'utf8');

    expect(config).toContain("'src/lib/**/*.ts'");
  });

  it('resolves the Next server-only marker through a Vitest-only shim', () => {
    const config = readFileSync('vitest.config.ts', 'utf8');
    const shim = readFileSync('src/test/server-only-stub.ts', 'utf8');

    expect(config).toContain(
      "'server-only': path.resolve(__dirname, 'src/test/server-only-stub.ts')",
    );
    expect(shim).toContain('export {}');
  });
});
