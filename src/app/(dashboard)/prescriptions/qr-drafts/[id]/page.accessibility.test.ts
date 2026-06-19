import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

describe('QrDraftReviewPage accessibility contract', () => {
  it('names the case selector for assistive technology', () => {
    expect(SOURCE).toContain('aria-label="QR下書きのケース選択"');
  });
});
