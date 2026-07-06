import { describe, expect, it } from 'vitest';
import {
  assessMedicationEquivalence,
  normalizeMedicationCode,
  normalizeMedicationText,
  rankMedicationEquivalenceCandidates,
  type MedicationMatchInput,
} from './medication-equivalence';

const reference: MedicationMatchInput = {
  clinical: {
    drugMasterId: 'drug_1',
    yjCode: 'YJ-0001',
    hotCode: 'HOT-0001',
    ingredientKey: 'acetaminophen',
    strengthKey: '500mg',
    dosageFormKey: 'tablet',
    genericNameKey: 'acetaminophen',
    medicationNameKey: 'acetaminophen tablet 500',
  },
  package: {
    gtin: '04987123456789',
    janCode: '4987123456789',
    packageQuantity: { value: 70, unitKey: 'sheet' },
  },
};

describe('medication equivalence domain', () => {
  it('normalizes medication codes and text keys', () => {
    expect(normalizeMedicationCode(' ｙｊ-0001 ')).toBe('YJ0001');
    expect(normalizeMedicationText('　アセトアミノフェン　錠　')).toBe('アセトアミノフェン 錠');
  });

  it('allows exact auto link for same drug master id', () => {
    const assessment = assessMedicationEquivalence(reference, {
      clinical: { drugMasterId: ' drug_1 ' },
    });

    expect(assessment).toMatchObject({
      clinicalConfidence: 'exact',
      clinicalBasis: ['same_drug_master_id'],
      clinicalAutoLinkAllowed: true,
      packageOnlyMatch: false,
      requiresPharmacistReview: false,
    });
  });

  it('treats same YJ code as exact clinical evidence', () => {
    const assessment = assessMedicationEquivalence(reference, {
      clinical: { yjCode: 'yj0001' },
    });

    expect(assessment.clinicalConfidence).toBe('exact');
    expect(assessment.clinicalBasis).toContain('same_yj_code');
    expect(assessment.clinicalAutoLinkAllowed).toBe(true);
  });

  it('treats HOT code as high confidence but not an automatic link by itself', () => {
    const assessment = assessMedicationEquivalence(reference, {
      clinical: { hotCode: 'HOT 0001' },
    });

    expect(assessment.clinicalConfidence).toBe('high');
    expect(assessment.clinicalBasis).toContain('same_hot_code');
    expect(assessment.clinicalAutoLinkAllowed).toBe(false);
    expect(assessment.requiresPharmacistReview).toBe(true);
  });

  it('offers ingredient-strength-form as a high confidence review candidate', () => {
    const assessment = assessMedicationEquivalence(reference, {
      clinical: {
        ingredientKey: 'acetaminophen',
        strengthKey: '500mg',
        dosageFormKey: 'tablet',
      },
    });

    expect(assessment.clinicalConfidence).toBe('high');
    expect(assessment.clinicalBasis).toEqual(['same_ingredient_strength_form']);
    expect(assessment.clinicalAutoLinkAllowed).toBe(false);
    expect(assessment.requiresPharmacistReview).toBe(true);
  });

  it('keeps generic name and dosage form matches below automatic-link confidence', () => {
    const assessment = assessMedicationEquivalence(reference, {
      clinical: {
        genericNameKey: 'Acetaminophen',
        dosageFormKey: 'TABLET',
      },
    });

    expect(assessment.clinicalConfidence).toBe('medium');
    expect(assessment.clinicalBasis).toEqual(['same_generic_name_dosage_form']);
    expect(assessment.clinicalAutoLinkAllowed).toBe(false);
  });

  it('does not treat GS1/GTIN/JAN package matches as clinical equivalence', () => {
    const assessment = assessMedicationEquivalence(reference, {
      clinical: {},
      package: { gtin: '04987123456789', janCode: '4987123456789' },
    });

    expect(assessment.clinicalConfidence).toBe('none');
    expect(assessment.packageConfidence).toBe('exact');
    expect(assessment.packageOnlyMatch).toBe(true);
    expect(assessment.clinicalAutoLinkAllowed).toBe(false);
    expect(assessment.warnings).toContain('package_match_without_clinical_identity');
  });

  it('warns when package evidence conflicts with YJ clinical evidence', () => {
    const assessment = assessMedicationEquivalence(reference, {
      clinical: { yjCode: 'YJ-9999' },
      package: { gtin: '04987123456789' },
    });

    expect(assessment.clinicalConfidence).toBe('none');
    expect(assessment.packageOnlyMatch).toBe(true);
    expect(assessment.warnings).toEqual(
      expect.arrayContaining(['yj_code_conflict', 'package_match_with_yj_conflict']),
    );
  });

  it('keeps normalized name-only matches low confidence', () => {
    const assessment = assessMedicationEquivalence(reference, {
      clinical: { medicationNameKey: 'acetaminophen tablet 500' },
    });

    expect(assessment.clinicalConfidence).toBe('low');
    expect(assessment.clinicalBasis).toEqual(['normalized_name_only']);
    expect(assessment.requiresPharmacistReview).toBe(true);
  });

  it('ranks clinical evidence before package-only evidence', () => {
    const ranked = rankMedicationEquivalenceCandidates(reference, [
      {
        clinical: {},
        package: { gtin: '04987123456789' },
      },
      {
        clinical: { ingredientKey: 'acetaminophen', strengthKey: '500mg', dosageFormKey: 'tablet' },
      },
      {
        clinical: { medicationNameKey: 'acetaminophen tablet 500' },
      },
    ]);

    expect(ranked.map((candidate) => candidate.assessment.clinicalConfidence)).toEqual([
      'high',
      'low',
      'none',
    ]);
  });
});
