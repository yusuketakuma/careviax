import { describe, expect, it } from 'vitest';
import {
  PATIENT_SHARE_CORRECTION_FIELD_OPTIONS,
  PATIENT_SHARE_CORRECTION_TARGET_LABELS,
} from './correction-request-labels';

describe('correction-request-labels', () => {
  it('maps shared correction field paths to UI labels', () => {
    expect(PATIENT_SHARE_CORRECTION_FIELD_OPTIONS.claim_note).toContainEqual({
      value: 'claim_note_text',
      label: '請求メモ',
    });
    expect(PATIENT_SHARE_CORRECTION_FIELD_OPTIONS.patient_profile).toContainEqual({
      value: 'primary_residence.address',
      label: '住所',
    });
  });

  it('keeps correction target labels separate from API validation', () => {
    expect(PATIENT_SHARE_CORRECTION_TARGET_LABELS.billing_candidate).toBe('算定候補');
  });
});
