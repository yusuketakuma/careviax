import { describe, expect, it } from 'vitest';
import { buildDiscrepancyReasonErrors } from './dispense-result-validation';

const prescribedLine = {
  id: 'line_1',
  drug_name: 'アムロジピン錠5mg',
  drug_code: 'YJ123',
  quantity: 14,
  unit: '錠',
};

describe('buildDiscrepancyReasonErrors', () => {
  it('does not require a discrepancy reason for a display-name difference when medication codes match', () => {
    expect(
      buildDiscrepancyReasonErrors({
        prescribedLines: [prescribedLine],
        submittedLines: [
          {
            line_id: 'line_1',
            actual_drug_name: 'アムロジピンOD錠5mg',
            actual_drug_code: ' YJ123 ',
            actual_quantity: 14,
            actual_unit: '錠',
            carry_type: 'carry',
          },
        ],
      }),
    ).toEqual([]);
  });

  it('requires a discrepancy reason when either medication code is missing or different', () => {
    expect(
      buildDiscrepancyReasonErrors({
        prescribedLines: [prescribedLine],
        submittedLines: [
          {
            line_id: 'line_1',
            actual_drug_name: prescribedLine.drug_name,
            actual_drug_code: null,
            actual_quantity: 14,
            actual_unit: '錠',
            carry_type: 'carry',
          },
          {
            line_id: 'line_1',
            actual_drug_name: prescribedLine.drug_name,
            actual_drug_code: 'YJ999',
            actual_quantity: 14,
            actual_unit: '錠',
            carry_type: 'carry',
          },
        ],
      }),
    ).toEqual([
      {
        line_id: 'line_1',
        prescribed_drug_name: prescribedLine.drug_name,
        reason: '処方との差異があるため理由コードが必須です',
      },
      {
        line_id: 'line_1',
        prescribed_drug_name: prescribedLine.drug_name,
        reason: '処方との差異があるため理由コードが必須です',
      },
    ]);
  });

  it('falls back to name comparison only when both medication codes are unresolved', () => {
    expect(
      buildDiscrepancyReasonErrors({
        prescribedLines: [{ ...prescribedLine, drug_code: null }],
        submittedLines: [
          {
            line_id: 'line_1',
            actual_drug_name: prescribedLine.drug_name,
            actual_drug_code: null,
            actual_quantity: 14,
            actual_unit: '錠',
            carry_type: 'carry',
          },
          {
            line_id: 'line_1',
            actual_drug_name: '別薬剤',
            actual_drug_code: null,
            actual_quantity: 14,
            actual_unit: '錠',
            carry_type: 'carry',
          },
        ],
      }),
    ).toEqual([
      {
        line_id: 'line_1',
        prescribed_drug_name: prescribedLine.drug_name,
        reason: '処方との差異があるため理由コードが必須です',
      },
    ]);
  });
});
