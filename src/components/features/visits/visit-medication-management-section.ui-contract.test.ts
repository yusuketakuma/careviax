import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SOURCE_PATH = 'src/components/features/visits/visit-medication-management-section.tsx';
const SUB_TWELVE_PIXEL_CLASS = /text-\[(?:[0-9]|1[01])px\]/g;

describe('visit medication management UI contract', () => {
  it('keeps source summaries and counts at 12px or larger', () => {
    const source = readFileSync(SOURCE_PATH, 'utf8');

    expect(source.match(SUB_TWELVE_PIXEL_CLASS)).toBeNull();
  });

  it('keeps every explicit source action at the 44px target on every breakpoint', () => {
    const source = readFileSync(SOURCE_PATH, 'utf8');
    const controls = source.match(/<(?:Button|Link|TabsTrigger|SelectTrigger)\b[\s\S]*?>/g) ?? [];

    expect(controls.length).toBe(4);
    for (const control of controls) {
      expect(control).toContain('min-h-11');
      expect(control).not.toContain('sm:min-h-0');
    }
  });

  it('keeps each evidence label as a full-height checkbox target', () => {
    const source = readFileSync(SOURCE_PATH, 'utf8');

    expect(source).toContain(
      '<Label htmlFor={id} className="min-h-11 flex-1 cursor-pointer space-y-1">',
    );
  });
});
