import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

describe('QrDraftReviewPage accessibility contract', () => {
  it('names the case selector for assistive technology', () => {
    expect(SOURCE).toContain('aria-label="QR下書きのケース選択"');
  });

  it('associates prescription header and line inputs with labels', () => {
    for (const snippet of [
      'htmlFor="qr-draft-prescribed-date"',
      'id="qr-draft-prescribed-date"',
      'htmlFor="qr-draft-prescriber-name"',
      'id="qr-draft-prescriber-name"',
      'htmlFor="qr-draft-prescriber-institution"',
      'id="qr-draft-prescriber-institution"',
      'qr-draft-line-${idx}-drug-name',
      'qr-draft-line-${idx}-drug-code',
      'qr-draft-line-${idx}-dose',
      'qr-draft-line-${idx}-frequency',
      'qr-draft-line-${idx}-days',
      'aria-label={`処方明細${idx + 1}件目の数量`}',
      'aria-label={`処方明細${idx + 1}件目の単位`}',
      'qr-draft-line-${idx}-dosage-form',
      'qr-draft-line-${idx}-start-date',
      'qr-draft-line-${idx}-end-date',
      'qr-draft-line-${idx}-packaging-instructions',
      'qr-draft-line-${idx}-notes',
    ]) {
      expect(SOURCE).toContain(snippet);
    }
  });
});
