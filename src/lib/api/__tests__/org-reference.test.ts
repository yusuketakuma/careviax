import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  patientFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
  medicationIssueFindFirstMock: vi.fn(),
  medicationCycleFindFirstMock: vi.fn(),
  setPlanFindFirstMock: vi.fn(),
  dispenseTaskFindFirstMock: vi.fn(),
  pharmacySiteFindFirstMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
  prescriptionLineFindManyMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: { findFirst: prismaMocks.patientFindFirstMock },
    careCase: { findFirst: prismaMocks.careCaseFindFirstMock },
    visitRecord: { findFirst: prismaMocks.visitRecordFindFirstMock },
    medicationIssue: { findFirst: prismaMocks.medicationIssueFindFirstMock },
    medicationCycle: { findFirst: prismaMocks.medicationCycleFindFirstMock },
    setPlan: { findFirst: prismaMocks.setPlanFindFirstMock },
    dispenseTask: { findFirst: prismaMocks.dispenseTaskFindFirstMock },
    pharmacySite: { findFirst: prismaMocks.pharmacySiteFindFirstMock },
    membership: { findFirst: prismaMocks.membershipFindFirstMock },
    visitSchedule: { findFirst: prismaMocks.visitScheduleFindFirstMock },
    prescriptionLine: { findMany: prismaMocks.prescriptionLineFindManyMock },
  },
}));

import { validateOrgReferences } from '../org-reference';

describe('validateOrgReferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.patientFindFirstMock.mockResolvedValue(null);
    prismaMocks.careCaseFindFirstMock.mockResolvedValue(null);
    prismaMocks.visitRecordFindFirstMock.mockResolvedValue(null);
    prismaMocks.medicationIssueFindFirstMock.mockResolvedValue(null);
    prismaMocks.medicationCycleFindFirstMock.mockResolvedValue(null);
    prismaMocks.setPlanFindFirstMock.mockResolvedValue(null);
    prismaMocks.dispenseTaskFindFirstMock.mockResolvedValue(null);
    prismaMocks.pharmacySiteFindFirstMock.mockResolvedValue(null);
    prismaMocks.membershipFindFirstMock.mockResolvedValue(null);
    prismaMocks.visitScheduleFindFirstMock.mockResolvedValue(null);
    prismaMocks.prescriptionLineFindManyMock.mockResolvedValue([]);
  });

  it('returns validation error when patient is missing', async () => {
    const result = await validateOrgReferences('org_1', { patient_id: 'patient_1' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('response is required');
    expect(result.response.status).toBe(400);
  });

  it('returns validation error when case does not belong to patient', async () => {
    prismaMocks.patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    prismaMocks.careCaseFindFirstMock.mockResolvedValue({
      id: 'case_1',
      patient_id: 'patient_2',
    });

    const result = await validateOrgReferences('org_1', {
      patient_id: 'patient_1',
      case_id: 'case_1',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('response is required');
    expect(result.response.status).toBe(400);
  });

  it('returns validation error when line ids do not belong to the task cycle', async () => {
    prismaMocks.dispenseTaskFindFirstMock.mockResolvedValue({
      id: 'task_1',
      cycle_id: 'cycle_1',
    });
    prismaMocks.prescriptionLineFindManyMock.mockResolvedValue([
      { id: 'line_1', intake: { cycle_id: 'cycle_2' } },
    ]);

    const result = await validateOrgReferences('org_1', {
      task_id: 'task_1',
      line_ids: ['line_1'],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('response is required');
    expect(result.response.status).toBe(400);
  });

  it('returns validation error when schedule does not belong to patient', async () => {
    prismaMocks.patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    prismaMocks.visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      cycle_id: null,
    });
    prismaMocks.careCaseFindFirstMock.mockResolvedValue({
      id: 'case_1',
      patient_id: 'patient_2',
    });

    const result = await validateOrgReferences('org_1', {
      patient_id: 'patient_1',
      schedule_id: 'schedule_1',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('response is required');
    expect(result.response.status).toBe(400);
  });

  it('returns loaded references when all references are valid', async () => {
    prismaMocks.patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    prismaMocks.careCaseFindFirstMock.mockResolvedValue({
      id: 'case_1',
      patient_id: 'patient_1',
    });
    prismaMocks.medicationIssueFindFirstMock.mockResolvedValue({
      id: 'issue_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
    });

    const result = await validateOrgReferences('org_1', {
      patient_id: 'patient_1',
      case_id: 'case_1',
      issue_id: 'issue_1',
    });

    expect(result).toEqual({
      ok: true,
      data: {
        patient: { id: 'patient_1' },
        careCase: { id: 'case_1', patient_id: 'patient_1' },
        visitRecord: null,
        issue: { id: 'issue_1', patient_id: 'patient_1', case_id: 'case_1' },
        cycle: null,
        plan: null,
        task: null,
        site: null,
        pharmacistMembership: null,
        schedule: null,
      },
    });
  });
});
