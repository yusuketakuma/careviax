import { describe, expect, it } from 'vitest';
import { buildQrDraftShortcutLinks, QR_DRAFT_CONFIRM_SUCCESS_HREF } from './page.helpers';

describe('qr draft page helpers', () => {
  it('routes confirmation success to an existing workflow surface', () => {
    expect(QR_DRAFT_CONFIRM_SUCCESS_HREF).toEqual('/prescriptions');
  });

  it('includes patient detail only when the draft is matched to a patient', () => {
    expect(buildQrDraftShortcutLinks('patient_1')).toEqual([
      { href: '/prescriptions', label: '処方受付一覧' },
      { href: '/patients/patient_1', label: '患者詳細' },
      { href: '/workflow', label: 'ワークフロー' },
    ]);

    expect(buildQrDraftShortcutLinks(null)).toEqual([
      { href: '/prescriptions', label: '処方受付一覧' },
      { href: '/workflow', label: 'ワークフロー' },
    ]);
  });
});
