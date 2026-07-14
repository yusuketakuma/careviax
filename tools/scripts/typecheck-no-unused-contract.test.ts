import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('typecheck package scripts', () => {
  it('does not reuse stale Next route type state after type generation', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const command = packageJson.scripts.typecheck;

    expect(command).toContain(
      'next typegen && node --max-old-space-size=8192 node_modules/typescript/bin/tsc --noEmit --pretty false --incremental false',
    );
  });

  it('covers both the main TypeScript project and the service worker project', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const command = packageJson.scripts['typecheck:no-unused'];

    expect(command).toContain(
      'node --max-old-space-size=8192 node_modules/typescript/bin/tsc --noEmit',
    );
    expect(command).toContain('tsc --noEmit');
    expect(command).toContain('tsc -p tsconfig.sw.json');
    expect(command.match(/--noUnusedLocals/g)).toHaveLength(2);
    expect(command.match(/--noUnusedParameters/g)).toHaveLength(2);
  });
});
