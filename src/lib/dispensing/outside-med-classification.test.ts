import { describe, expect, it } from 'vitest';
import {
  OUTSIDE_MED_EVIDENCE_KIND_LABELS,
  deriveOutsideMedEvidenceKind,
  isInternalRoute,
  type OutsideMedClassifiableLine,
} from './outside-med-classification';
import { OUTSIDE_MED_EVIDENCE_KINDS } from './set-audit-constants';

function line(overrides: Partial<OutsideMedClassifiableLine> = {}): OutsideMedClassifiableLine {
  return {
    drug_name: 'アムロジピン錠5mg',
    dosage_form: '錠',
    frequency: '1日1回朝食後',
    route: 'internal',
    packaging_instruction_tags: [],
    packaging_instructions: null,
    notes: null,
    unit: '錠',
    ...overrides,
  };
}

describe('isInternalRoute', () => {
  it('treats oral/internal/内服/未指定 as internal', () => {
    expect(isInternalRoute('internal')).toBe(true);
    expect(isInternalRoute('oral')).toBe(true);
    expect(isInternalRoute('内服')).toBe(true);
    expect(isInternalRoute(null)).toBe(true);
    expect(isInternalRoute(undefined)).toBe(true);
  });

  it('treats other routes as external', () => {
    expect(isInternalRoute('injection')).toBe(false);
    expect(isInternalRoute('external')).toBe(false);
    expect(isInternalRoute('topical')).toBe(false);
  });
});

describe('deriveOutsideMedEvidenceKind', () => {
  it('returns null for a plain internal oral tablet (set 同梱可)', () => {
    expect(deriveOutsideMedEvidenceKind(line())).toBeNull();
  });

  it('classifies non-internal injection route as injection', () => {
    expect(
      deriveOutsideMedEvidenceKind(line({ route: 'injection', drug_name: 'インスリン' })),
    ).toBe('injection');
  });

  it('classifies a non-internal liquid as liquid before falling back to topical', () => {
    expect(deriveOutsideMedEvidenceKind(line({ route: 'external', drug_name: '点眼液 5mL' }))).toBe(
      'liquid',
    );
  });

  it('classifies a non-internal non-liquid as topical', () => {
    expect(
      deriveOutsideMedEvidenceKind(line({ route: 'external', drug_name: 'ロキソニンテープ' })),
    ).toBe('topical');
  });

  it('classifies internal cold-storage by tag or text', () => {
    expect(
      deriveOutsideMedEvidenceKind(line({ packaging_instruction_tags: ['cold_storage'] })),
    ).toBe('cold');
    expect(deriveOutsideMedEvidenceKind(line({ notes: '冷所保存' }))).toBe('cold');
    expect(deriveOutsideMedEvidenceKind(line({ drug_name: 'ナウゼリン坐剤' }))).toBe('cold');
  });

  it('classifies internal injection text (e.g. self-injection) as injection', () => {
    expect(deriveOutsideMedEvidenceKind(line({ drug_name: 'インスリン グラルギン' }))).toBe(
      'injection',
    );
  });

  it('classifies internal topical keywords as topical', () => {
    expect(deriveOutsideMedEvidenceKind(line({ drug_name: 'モーラステープ', notes: '外用' }))).toBe(
      'topical',
    );
  });

  it('classifies internal liquid keywords as liquid', () => {
    expect(deriveOutsideMedEvidenceKind(line({ drug_name: 'カロナールシロップ 内用液' }))).toBe(
      'liquid',
    );
  });

  it('classifies internal prn frequency as prn when no stronger signal matches', () => {
    expect(deriveOutsideMedEvidenceKind(line({ frequency: '頓服' }))).toBe('prn');
  });

  it('prioritises cold over other internal signals', () => {
    // 冷所 + 液 の両方を含む場合、内服分岐の先頭(cold)が優先される。
    expect(deriveOutsideMedEvidenceKind(line({ drug_name: '内用液', notes: '冷所保存' }))).toBe(
      'cold',
    );
  });
});

describe('OUTSIDE_MED_EVIDENCE_KIND_LABELS', () => {
  it('provides a Japanese label for every evidence kind', () => {
    for (const kind of OUTSIDE_MED_EVIDENCE_KINDS) {
      expect(OUTSIDE_MED_EVIDENCE_KIND_LABELS[kind]).toBeTruthy();
    }
    expect(OUTSIDE_MED_EVIDENCE_KIND_LABELS).toEqual({
      prn: '頓服',
      topical: '外用',
      cold: '冷所',
      injection: '注射',
      liquid: '液剤',
      other: 'その他',
    });
  });
});
