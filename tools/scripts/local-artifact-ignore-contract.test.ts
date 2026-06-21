import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function isIgnored(path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', path], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('local artifact ignore contract', () => {
  it('ignores local agent artifacts without hiding source backup-like names', () => {
    expect(isIgnored('agmsg/state.bak')).toBe(true);
    expect(isIgnored('agmsg/state.bak.1')).toBe(true);
    expect(isIgnored('Plans.md.bak.1')).toBe(true);

    expect(isIgnored('src/server/foo.bak.ts')).toBe(false);
    expect(isIgnored('src/server/foo.bak.tmp')).toBe(false);
    expect(isIgnored('src/server/foo.bak')).toBe(false);
  });
});
