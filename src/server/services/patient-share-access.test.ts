import { describe, expect, it } from 'vitest';
import {
  buildActivePatientShareCaseMutationWhere,
  buildActivePatientShareCaseReadWhere,
  buildPatientShareCaseConsentLockKey,
  PATIENT_SHARE_CASE_CONSENT_LOCK_NAMESPACE,
} from './patient-share-access';

describe('patient-share active access predicates', () => {
  it('keeps read and mutation eligibility on one predicate', () => {
    const asOf = new Date('2026-06-19T00:00:00.000Z');

    expect(buildActivePatientShareCaseMutationWhere({ orgId: 'org_1', asOf })).toEqual(
      buildActivePatientShareCaseReadWhere({ orgId: 'org_1', asOf }),
    );
  });

  it('uses the Japan business date for inclusive case and consent boundaries', () => {
    const where = buildActivePatientShareCaseMutationWhere({
      orgId: 'org_1',
      asOf: new Date('2026-06-19T15:30:00.000Z'),
    });
    const jstDate = new Date('2026-06-20T00:00:00.000Z');

    expect(where).toEqual({
      org_id: 'org_1',
      status: 'active',
      revoked_at: null,
      ended_at: null,
      partnership: {
        status: 'active',
        partner_pharmacy: { status: 'active' },
        OR: [{ effective_from: null }, { effective_from: { lte: jstDate } }],
        AND: [{ OR: [{ effective_to: null }, { effective_to: { gte: jstDate } }] }],
      },
      OR: [{ starts_at: null }, { starts_at: { lte: jstDate } }],
      AND: [
        { OR: [{ ends_at: null }, { ends_at: { gte: jstDate } }] },
        {
          consents: {
            some: {
              revoked_at: null,
              consent_date: { lte: jstDate },
              OR: [{ valid_until: null }, { valid_until: { gte: jstDate } }],
            },
          },
        },
      ],
    });
  });

  it.each([
    ['2026-06-19T14:59:59.000Z', '2026-06-19T00:00:00.000Z'],
    ['2026-06-19T15:00:00.000Z', '2026-06-20T00:00:00.000Z'],
  ])('switches active predicates at the JST day boundary: %s', (asOf, expectedDate) => {
    const where = buildActivePatientShareCaseMutationWhere({
      orgId: 'org_1',
      asOf: new Date(asOf),
    });
    const date = new Date(expectedDate);

    expect(where).toEqual(
      expect.objectContaining({
        OR: [{ starts_at: null }, { starts_at: { lte: date } }],
        AND: expect.arrayContaining([{ OR: [{ ends_at: null }, { ends_at: { gte: date } }] }]),
      }),
    );
  });

  it('builds a tenant-scoped consent mutation lock key', () => {
    expect(PATIENT_SHARE_CASE_CONSENT_LOCK_NAMESPACE).toBe('patient_share_case_consent');
    expect(
      buildPatientShareCaseConsentLockKey({ orgId: 'org_1', shareCaseId: 'share_case_1' }),
    ).toBe('org_1:share_case_1');
    expect(
      buildPatientShareCaseConsentLockKey({ orgId: 'org_2', shareCaseId: 'share_case_1' }),
    ).not.toBe('org_1:share_case_1');
  });
});
