import { describe, expect, it } from 'vitest';
import { getVisitReceiptReadiness, normalizeVisitReceiptPayload } from './visit-record-form.shared';

describe('getVisitReceiptReadiness', () => {
  it('treats an untouched receipt block as optional and incomplete', () => {
    expect(
      getVisitReceiptReadiness({
        receipt_person_name: '',
        receipt_person_relation: '',
        receipt_at: '2026-06-15T00:00',
      }),
    ).toEqual({
      hasIdentityInput: false,
      hasCompleteIdentity: false,
      missingLabels: [],
    });
  });

  it('requires name, relation, and timestamp once receipt identity is started', () => {
    expect(
      getVisitReceiptReadiness({
        receipt_person_name: '山田 花子',
        receipt_person_relation: '',
        receipt_at: '2026-06-15T14:30',
      }),
    ).toEqual({
      hasIdentityInput: true,
      hasCompleteIdentity: false,
      missingLabels: ['続柄'],
    });

    expect(
      getVisitReceiptReadiness({
        receipt_person_name: '',
        receipt_person_relation: 'child',
        receipt_at: '',
      }),
    ).toEqual({
      hasIdentityInput: true,
      hasCompleteIdentity: false,
      missingLabels: ['受領者名', '受領日時'],
    });
  });

  it('marks receipt evidence complete only when all identity fields are present', () => {
    expect(
      getVisitReceiptReadiness({
        receipt_person_name: '山田 花子',
        receipt_person_relation: 'child',
        receipt_at: '2026-06-15T14:30',
      }),
    ).toEqual({
      hasIdentityInput: true,
      hasCompleteIdentity: true,
      missingLabels: [],
    });
  });
});

describe('normalizeVisitReceiptPayload', () => {
  it('drops the default receipt timestamp when no receiver identity was entered', () => {
    expect(
      normalizeVisitReceiptPayload({
        receipt_person_name: '',
        receipt_person_relation: '',
        receipt_at: '2026-06-15T00:00',
        soap_plan: '次回確認',
      }),
    ).toEqual({
      receipt_person_name: undefined,
      receipt_person_relation: undefined,
      receipt_at: undefined,
      soap_plan: '次回確認',
    });
  });

  it('trims started receipt identity fields before submission', () => {
    expect(
      normalizeVisitReceiptPayload({
        receipt_person_name: ' 山田 花子 ',
        receipt_person_relation: ' child ',
        receipt_at: ' 2026-06-15T14:30 ',
      }),
    ).toEqual({
      receipt_person_name: '山田 花子',
      receipt_person_relation: 'child',
      receipt_at: '2026-06-15T14:30',
    });
  });
});
