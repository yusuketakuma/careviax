import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), 'utf8');

const globalsCss = readSource('src/app/globals.css');
const appHeaderSource = readSource('src/components/layout/app-header.tsx');
const HEADER_OFFSET_CONSUMERS = [
  'src/app/(dashboard)/patients/[id]/card-workspace.tsx',
  'src/app/(dashboard)/visits/[id]/record/visit-record-form.tsx',
] as const;

describe('shared shell geometry contract', () => {
  it('defines one fixed app-header height and derives focus offsets from it', () => {
    expect(globalsCss.match(/--app-header-height:/g)).toHaveLength(1);
    expect(globalsCss).toContain('--app-header-height: 3.5rem;');
    expect(globalsCss.match(/calc\(var\(--app-header-height\) \+ 1rem\) 88px/g)).toHaveLength(3);
  });

  it('keeps the shared top bar fixed instead of content-sized', () => {
    expect(appHeaderSource).toContain('h-[var(--app-header-height)]');
    expect(appHeaderSource).toContain('flex h-full min-w-0');
    expect(appHeaderSource).not.toContain('flex min-h-14 min-w-0');
  });

  it.each(HEADER_OFFSET_CONSUMERS)('%s derives its sticky offset from the shell token', (path) => {
    const source = readSource(path);

    expect(source).toContain('top-[var(--app-header-height)]');
    expect(source).not.toContain('top-14');
  });
});
