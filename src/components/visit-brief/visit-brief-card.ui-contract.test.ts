import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CARD_PATH = 'src/components/visit-brief/visit-brief-card.tsx';
const SUB_TWELVE_PIXEL_CLASS = /text-\[(?:[0-9]|1[01])px\]/g;

describe('visit brief card UI contract', () => {
  it('keeps clinical, source, and generation labels at 12px or larger', () => {
    const source = readFileSync(CARD_PATH, 'utf8');

    expect(source.match(SUB_TWELVE_PIXEL_CLASS)).toBeNull();
  });

  it('keeps every card button and action link at the 44px target on every breakpoint', () => {
    const source = readFileSync(CARD_PATH, 'utf8');
    const buttons = source.match(/<Button[\s\S]*?\n\s*>/g) ?? [];
    const links = source.match(/<Link[\s\S]*?\n\s*>/g) ?? [];

    expect(buttons.length).toBeGreaterThan(0);
    expect(links.length).toBeGreaterThan(0);
    for (const control of [...buttons, ...links]) {
      expect(control).toContain('min-h-11');
      expect(control).not.toContain('sm:min-h-0');
    }
  });
});
