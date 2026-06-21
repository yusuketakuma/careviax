import { describe, expect, it } from 'vitest';
import { normalizeAllergyInfoForPatientForm } from './patient-edit-content';

describe('normalizeAllergyInfoForPatientForm', () => {
  it('keeps schema-valid allergy entries for patient edit defaults', () => {
    expect(
      normalizeAllergyInfoForPatientForm([
        {
          drug_name: 'ペニシリン',
          category: 'drug',
          severity: 'moderate',
          confirmed_at: '2026-06-01',
        },
      ]),
    ).toEqual([
      {
        drug_name: 'ペニシリン',
        category: 'drug',
        severity: 'moderate',
        confirmed_at: '2026-06-01',
      },
    ]);
  });

  it('omits legacy allergy entries so unrelated edits preserve stored JSON', () => {
    expect(
      normalizeAllergyInfoForPatientForm([
        { drug_name: '造影剤', memo: 'legacy format without category/severity' },
      ]),
    ).toBeUndefined();
    expect(normalizeAllergyInfoForPatientForm(['ペニシリン allergy note'])).toBeUndefined();
  });
});
