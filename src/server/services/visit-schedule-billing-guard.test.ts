import { beforeEach, describe, expect, it, vi } from 'vitest';

const { validateBillingRequirementsMock } = vi.hoisted(() => ({
  validateBillingRequirementsMock: vi.fn(),
}));

vi.mock('./billing-requirement-validator', () => ({
  validateBillingRequirements: validateBillingRequirementsMock,
}));

import { validateVisitScheduleBlockingBillingRequirements } from './visit-schedule-billing-guard';

function createDb() {
  const patientInsuranceFindFirstMock = vi.fn(
    async (args: { where: { insurance_type: string } }) =>
      args.where.insurance_type === 'medical' ? { number: 'MED-001' } : null,
  );

  return {
    db: {
      patientInsurance: {
        findFirst: patientInsuranceFindFirstMock,
      },
      visitSchedule: {
        findMany: vi.fn(),
        count: vi.fn(),
      },
      visitScheduleProposal: {
        findMany: vi.fn(),
      },
      user: {
        findFirst: vi.fn(),
      },
      consentRecord: {
        findFirst: vi.fn(),
      },
      managementPlan: {
        findFirst: vi.fn(),
      },
    },
    patientInsuranceFindFirstMock,
  };
}

describe('validateVisitScheduleBlockingBillingRequirements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateBillingRequirementsMock.mockResolvedValue([]);
  });

  it('queries insurance with UTC date sentinels for @db.Date proposal dates', async () => {
    const { db, patientInsuranceFindFirstMock } = createDb();

    const result = await validateVisitScheduleBlockingBillingRequirements({
      db,
      orgId: 'org_1',
      caseId: 'case_1',
      patientId: 'patient_1',
      pharmacistId: 'pharm_1',
      visitType: 'regular',
      proposedDate: new Date('2026-04-03T00:00:00.000Z'),
      requiredVisitSupport: null,
    });

    expect(result.payerBasis).toBe('medical');
    expect(patientInsuranceFindFirstMock).toHaveBeenCalledTimes(2);
    const medicalWhere = patientInsuranceFindFirstMock.mock.calls[0]?.[0].where;
    expect(medicalWhere).toEqual(
      expect.objectContaining({
        org_id: 'org_1',
        patient_id: 'patient_1',
        insurance_type: 'medical',
        OR: [{ valid_from: null }, { valid_from: { lte: new Date('2026-04-03T00:00:00.000Z') } }],
        AND: [
          {
            OR: [
              { valid_until: null },
              { valid_until: { gte: new Date('2026-04-03T00:00:00.000Z') } },
            ],
          },
        ],
      }),
    );
    expect(validateBillingRequirementsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payerBasis: 'medical',
        proposedDate: new Date('2026-04-03T00:00:00.000Z'),
      }),
    );
  });
});
