import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('build:e2e:local package script', () => {
  it('uses the repository production-build heap limit for the Next compiler', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['build:e2e:local']).toContain(
      'node --max-old-space-size=8192 node_modules/next/dist/bin/next build --webpack',
    );
  });
});
