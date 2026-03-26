import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  withOrgContextMock,
  visitScheduleFindFirstMock,
  careCaseFindFirstMock,
  visitRecordCreateMock,
  visitScheduleUpdateMock,
  consentRecordFindFirstMock,
  medicationCycleFindFirstMock,
  medicationCycleUpdateMock,
  workflowExceptionFindFirstMock,
  workflowExceptionCreateMock,
  taskUpsertMock,
  billingEvidenceUpsertMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  visitRecordCreateMock: vi.fn(),
  visitScheduleUpdateMock: vi.fn(),
  consentRecordFindFirstMock: vi.fn(),
  medicationCycleFindFirstMock: vi.fn(),
  medicationCycleUpdateMock: vi.fn(),
  workflowExceptionFindFirstMock: vi.fn(),
  workflowExceptionCreateMock: vi.fn(),
  taskUpsertMock: vi.fn(),
  billingEvidenceUpsertMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/billing-evidence', () => ({
  upsertBillingEvidenceForVisit: billingEvidenceUpsertMock,
}));

import { POST } from './route';

function createRequest(body: unknown, headers?: Record<string, string>) {
  return {
    url: 'http://localhost/api/visit-records',
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/visit-records POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'ready',
      recurrence_rule: null,
      cycle_id: 'cycle_1',
    });
    careCaseFindFirstMock.mockResolvedValue({
      patient_id: 'patient_1',
    });
    visitRecordCreateMock.mockResolvedValue({ id: 'record_1' });
    visitScheduleUpdateMock.mockResolvedValue({ id: 'schedule_1' });
    consentRecordFindFirstMock.mockResolvedValue({ id: 'consent_1' });
    medicationCycleFindFirstMock.mockResolvedValue({
      id: 'cycle_1',
      overall_status: 'visit_ready',
    });
    medicationCycleUpdateMock.mockResolvedValue({ id: 'cycle_1' });
    workflowExceptionFindFirstMock.mockResolvedValue(null);
    workflowExceptionCreateMock.mockResolvedValue({ id: 'exception_1' });
    taskUpsertMock.mockResolvedValue({ id: 'task_1' });
    billingEvidenceUpsertMock.mockResolvedValue({ id: 'evidence_1' });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findFirst: visitScheduleFindFirstMock,
          update: visitScheduleUpdateMock,
        },
        careCase: {
          findFirst: careCaseFindFirstMock,
        },
        visitRecord: {
          create: visitRecordCreateMock,
        },
        consentRecord: {
          findFirst: consentRecordFindFirstMock,
        },
        medicationCycle: {
          findFirst: medicationCycleFindFirstMock,
          update: medicationCycleUpdateMock,
        },
        workflowException: {
          findFirst: workflowExceptionFindFirstMock,
          create: workflowExceptionCreateMock,
        },
        task: {
          upsert: taskUpsertMock,
          create: taskUpsertMock,
        },
      })
    );
  });

  it('returns 400 when the request patient does not match the scheduled case', async () => {
    careCaseFindFirstMock.mockResolvedValue({
      patient_id: 'patient_2',
    });

    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'completed',
        },
        { 'x-org-id': 'org_1' }
      )
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問予定に紐づく患者と記録対象患者が一致しません',
    });
    expect(visitRecordCreateMock).not.toHaveBeenCalled();
  });

  it('marks postponed visits as postponed without advancing the visit workflow', async () => {
    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'postponed',
          postpone_reason: '発熱のため延期',
        },
        { 'x-org-id': 'org_1' }
      )
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitRecordCreateMock).toHaveBeenCalledOnce();
    expect(visitScheduleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'schedule_1' },
      data: { schedule_status: 'postponed' },
    });
    expect(consentRecordFindFirstMock).not.toHaveBeenCalled();
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    expect(medicationCycleUpdateMock).not.toHaveBeenCalled();
    expect(workflowExceptionCreateMock).not.toHaveBeenCalled();
  });
});
