import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const FORM_PATH = 'src/app/(dashboard)/prescriptions/new/prescription-intake-form.tsx';
const SUB_TWELVE_PIXEL_CLASS = /text-\[(?:[0-9]|1[01])px\]/g;

describe('prescription intake UI contract', () => {
  it('keeps clinical, price, and diff text at 12px or larger', () => {
    const source = readFileSync(FORM_PATH, 'utf8');

    expect(source.match(SUB_TWELVE_PIXEL_CLASS)).toBeNull();
  });

  it('does not shrink 44px controls below the PH-OS target on desktop', () => {
    const source = readFileSync(FORM_PATH, 'utf8');

    expect(source).not.toContain('sm:min-h-0');
    expect(source).not.toMatch(/min-h-\[44px\]\s+sm:h-/);
    const nativeButtons = source.match(/<button[\s\S]*?\n\s*>/g) ?? [];
    expect(nativeButtons.length).toBeGreaterThan(0);
    for (const button of nativeButtons) {
      expect(button).toMatch(/(?:min-h-11|size-11)/);
    }
  });

  it('uses guarded URL builders for dynamic QR paths and institution queries', () => {
    const source = readFileSync(FORM_PATH, 'utf8');

    expect(source).toContain('url: buildQrDraftApiUrl(initialQrDraftId)');
    expect(source).toContain('url: buildPrescriberInstitutionsApiPath(params)');
    expect(source).not.toContain('`/api/qr-scan-drafts/${initialQrDraftId}`');
    expect(source).not.toContain('`/api/prescriber-institutions?${params.toString()}`');
  });
});
