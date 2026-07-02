import { describe, expect, it } from 'vitest';
import {
  collectDrugCodeResolutionReviewDetails,
  enrichQrDraftLineFromParsedData,
  findQrDraftLineMismatches,
} from './qr-draft-line-readers';

const parsedData = {
  lines: [
    {
      drugName: ' アムロジピン錠5mg ',
      drugCode: ' 2149001 ',
      sourceDrugCode: ' RC_AMLO ',
      sourceDrugCodeType: ' receipt ',
      drugCodeResolutionStatus: ' resolved ',
      dosageForm: ' 錠剤 ',
      dose: ' 1錠 ',
      frequency: ' 1日1回朝食後 ',
      days: 14,
      quantity: ' 14 ',
      unit: ' 錠 ',
      isGeneric: true,
      packagingMethod: ' blister_pack ',
      packagingInstructions: ' PTP管理 ',
      packagingInstructionTags: [' ptp ', '', ' no_unit_dose ', 'unsupported'],
      route: ' internal ',
      dispensingMethod: ' standard ',
      startDate: ' 2026-06-01 ',
      endDate: ' 2026-06-14 ',
      notes: ' QR備考 ',
    },
  ],
};

const requestLine = {
  drug_name: 'アムロジピン錠5mg',
  drug_code: '2149001',
  dosage_form: '錠剤',
  dose: '1錠',
  frequency: '1日1回朝食後',
  days: 14,
  quantity: 14,
  unit: '錠',
  is_generic: true,
  packaging_method: 'blister_pack' as const,
  packaging_instructions: 'PTP管理',
  packaging_instruction_tags: ['no_unit_dose', 'ptp'] as Array<'no_unit_dose' | 'ptp'>,
  route: 'internal' as const,
  dispensing_method: 'standard' as const,
  start_date: '2026-06-01',
  end_date: '2026-06-14',
  notes: 'QR備考',
};

describe('qr-draft-line-readers', () => {
  it('trims QR parsed_data fallback fields and filters enum arrays', () => {
    const enriched = enrichQrDraftLineFromParsedData(
      {
        drug_name: 'アムロジピン錠5mg',
        dose: '1錠',
        frequency: '1日1回朝食後',
        days: 14,
      },
      parsedData,
      0,
    );

    expect(enriched).toMatchObject({
      drug_code: '2149001',
      source_drug_code: 'RC_AMLO',
      source_drug_code_type: 'receipt',
      dosage_form: '錠剤',
      quantity: 14,
      unit: '錠',
      is_generic: true,
      packaging_method: 'blister_pack',
      packaging_instructions: 'PTP管理',
      packaging_instruction_tags: ['ptp', 'no_unit_dose'],
      route: 'internal',
      dispensing_method: 'standard',
      start_date: '2026-06-01',
      end_date: '2026-06-14',
      notes: 'QR備考',
    });
  });

  it('compares request lines against trimmed QR parsed_data values', () => {
    expect(findQrDraftLineMismatches({ lines: [requestLine] }, parsedData)).toEqual([]);
  });

  it('preserves the raw-request is_generic override semantics for direct QR intake imports', () => {
    const submittedLine = { ...requestLine, is_generic: false };

    expect(
      findQrDraftLineMismatches({ lines: [submittedLine] }, parsedData, { lines: [{}] }),
    ).toEqual([]);
    expect(
      findQrDraftLineMismatches({ lines: [submittedLine] }, parsedData, {
        lines: [{ is_generic: false }],
      }),
    ).toEqual(['line_1_is_generic']);

    expect(
      enrichQrDraftLineFromParsedData(submittedLine, parsedData, 0, { lines: [{}] }).is_generic,
    ).toBe(true);
    expect(
      enrichQrDraftLineFromParsedData(submittedLine, parsedData, 0, {
        lines: [{ is_generic: false }],
      }).is_generic,
    ).toBe(false);
  });

  it('trims drug-code resolution status and source code before requiring review', () => {
    expect(
      collectDrugCodeResolutionReviewDetails(parsedData, { lines: [{ ...requestLine }] }),
    ).toBeNull();

    expect(
      collectDrugCodeResolutionReviewDetails(
        {
          lines: [
            {
              ...parsedData.lines[0],
              drugCode: '   ',
              drugCodeResolutionStatus: ' review_required ',
            },
          ],
        },
        { lines: [{ ...requestLine, drug_master_id: 'drug_master_1' }] },
      ),
    ).toBeNull();
  });
});
