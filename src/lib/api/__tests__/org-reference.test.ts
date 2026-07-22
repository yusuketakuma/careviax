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
  membershipFindManyMock: vi.fn(),
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
    membership: {
      findFirst: prismaMocks.membershipFindFirstMock,
      findMany: prismaMocks.membershipFindManyMock,
    },
    visitSchedule: { findFirst: prismaMocks.visitScheduleFindFirstMock },
    prescriptionLine: { findMany: prismaMocks.prescriptionLineFindManyMock },
  },
}));

import { type OrgReferenceDb, validateOrgReferences } from '../org-reference';

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
    prismaMocks.membershipFindManyMock.mockResolvedValue([]);
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

  it('uses only the injected database delegates across every validation branch', async () => {
    const injectedMocks = {
      patient: vi.fn().mockResolvedValue({ id: 'patient_1' }),
      careCase: vi.fn().mockResolvedValue({ id: 'case_1', patient_id: 'patient_1' }),
      visitRecord: vi.fn().mockResolvedValue({ id: 'visit_1', patient_id: 'patient_1' }),
      medicationIssue: vi
        .fn()
        .mockResolvedValue({ id: 'issue_1', patient_id: 'patient_1', case_id: 'case_1' }),
      medicationCycle: vi.fn().mockResolvedValue({
        id: 'cycle_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        overall_status: 'active',
      }),
      setPlan: vi.fn().mockResolvedValue({ id: 'plan_1', cycle_id: 'cycle_1' }),
      dispenseTask: vi.fn().mockResolvedValue({ id: 'task_1', cycle_id: 'cycle_1' }),
      pharmacySite: vi.fn().mockResolvedValue({ id: 'site_1' }),
      membershipFindFirst: vi.fn().mockResolvedValue({ user_id: 'pharmacist_1' }),
      membershipFindMany: vi
        .fn()
        .mockResolvedValue([{ user_id: 'pharmacist_1' }, { user_id: 'staff_1' }]),
      visitSchedule: vi
        .fn()
        .mockResolvedValue({ id: 'schedule_1', case_id: 'case_1', cycle_id: 'cycle_1' }),
      prescriptionLine: vi
        .fn()
        .mockResolvedValue([{ id: 'line_1', intake: { cycle_id: 'cycle_1' } }]),
    };
    const injectedDb = {
      patient: { findFirst: injectedMocks.patient },
      careCase: { findFirst: injectedMocks.careCase },
      visitRecord: { findFirst: injectedMocks.visitRecord },
      medicationIssue: { findFirst: injectedMocks.medicationIssue },
      medicationCycle: { findFirst: injectedMocks.medicationCycle },
      setPlan: { findFirst: injectedMocks.setPlan },
      dispenseTask: { findFirst: injectedMocks.dispenseTask },
      pharmacySite: { findFirst: injectedMocks.pharmacySite },
      membership: {
        findFirst: injectedMocks.membershipFindFirst,
        findMany: injectedMocks.membershipFindMany,
      },
      visitSchedule: { findFirst: injectedMocks.visitSchedule },
      prescriptionLine: { findMany: injectedMocks.prescriptionLine },
    } as unknown as OrgReferenceDb;

    const result = await validateOrgReferences(
      'org_1',
      {
        patient_id: 'patient_1',
        case_id: 'case_1',
        visit_record_id: 'visit_1',
        issue_id: 'issue_1',
        cycle_id: 'cycle_1',
        plan_id: 'plan_1',
        task_id: 'task_1',
        site_id: 'site_1',
        pharmacist_id: 'pharmacist_1',
        pharmacist_ids: ['pharmacist_1'],
        staff_ids: ['staff_1'],
        schedule_id: 'schedule_1',
        line_ids: ['line_1'],
      },
      injectedDb,
    );

    expect(result.ok).toBe(true);
    for (const mock of Object.values(injectedMocks)) {
      expect(mock).toHaveBeenCalled();
    }
    for (const mock of Object.values(prismaMocks)) {
      expect(mock).not.toHaveBeenCalled();
    }
  });
});
