import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  visitScheduleFindFirstMock,
  visitScheduleUpdateMock,
  visitPreparationFindFirstMock,
  careCaseFindFirstMock,
  validateOrgReferencesMock,
  notifyWorkflowMutationMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
  visitScheduleUpdateMock: vi.fn(),
  visitPreparationFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    visitSchedule: {
      findFirst: visitScheduleFindFirstMock,
    },
    visitPreparation: {
      findFirst: visitPreparationFindFirstMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { DELETE, GET, PATCH } from './route';

function createRequest(headers?: Record<string, string>) {
  return {
    url: 'http://localhost/api/visit-schedules/schedule_1',
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
  } as unknown as NextRequest;
}

describe('/api/visit-schedules/[id] GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    validateOrgReferencesMock.mockResolvedValue({ ok: true, data: {} });
    notifyWorkflowMutationMock.mockResolvedValue(undefined);
    visitScheduleUpdateMock.mockResolvedValue({ id: 'schedule_1', schedule_status: 'in_progress' });
    visitPreparationFindFirstMock.mockResolvedValue({
      medication_changes_reviewed: true,
      carry_items_confirmed: true,
      previous_issues_reviewed: true,
      route_confirmed: true,
      offline_synced: true,
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          update: visitScheduleUpdateMock,
        },
      }),
    );
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      cycle_id: 'cycle_1',
      visit_type: 'regular',
      scheduled_date: '2026-03-26',
      confirmed_at: null,
      pharmacist_id: 'user_1',
      visit_record: null,
      preparation: null,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });
    careCaseFindFirstMock.mockResolvedValue({
      patient_id: 'patient_1',
    });
  });

  it('returns the patient_id derived from the scheduled case', async () => {
    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: 'schedule_1',
      case_id: 'case_1',
      cycle_id: 'cycle_1',
      patient_id: 'patient_1',
    });
  });

  it('returns 403 when a pharmacist reads a schedule they are not assigned to', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      cycle_id: 'cycle_1',
      visit_type: 'regular',
      scheduled_date: '2026-03-26',
      confirmed_at: null,
      pharmacist_id: 'user_other',
      visit_record: null,
      preparation: null,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
  });

  it('returns 403 when a pharmacist patches a schedule they are not assigned to', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      confirmed_at: null,
      pharmacist_id: 'user_other',
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await PATCH(
      {
        url: 'http://localhost/api/visit-schedules/schedule_1',
        headers: {
          get: (key: string) => ({ 'x-org-id': 'org_1' })[key] ?? null,
        },
        json: vi.fn().mockResolvedValue({ schedule_status: 'in_progress' }),
      } as unknown as NextRequest,
      {
        params: Promise.resolve({ id: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('allows an assigned pharmacist to patch a schedule', async () => {
    const response = await PATCH(
      {
        url: 'http://localhost/api/visit-schedules/schedule_1',
        headers: {
          get: (key: string) => ({ 'x-org-id': 'org_1' })[key] ?? null,
        },
        json: vi.fn().mockResolvedValue({ schedule_status: 'in_progress' }),
      } as unknown as NextRequest,
      {
        params: Promise.resolve({ id: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitScheduleUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'schedule_1' },
        data: expect.objectContaining({
          schedule_status: 'in_progress',
          version: { increment: 1 },
        }),
      }),
    );
  });

  it('returns 403 when an assigned pharmacist attempts to reassign case or pharmacist', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      confirmed_at: null,
      pharmacist_id: 'user_1',
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await PATCH(
      {
        url: 'http://localhost/api/visit-schedules/schedule_1',
        headers: {
          get: (key: string) => ({ 'x-org-id': 'org_1' })[key] ?? null,
        },
        json: vi.fn().mockResolvedValue({ case_id: 'case_other', pharmacist_id: 'user_other' }),
      } as unknown as NextRequest,
      {
        params: Promise.resolve({ id: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects reversed time windows before loading or mutating the schedule', async () => {
    const response = await PATCH(
      {
        url: 'http://localhost/api/visit-schedules/schedule_1',
        headers: {
          get: (key: string) => ({ 'x-org-id': 'org_1' })[key] ?? null,
        },
        json: vi.fn().mockResolvedValue({
          time_window_start: '11:00',
          time_window_end: '10:00',
        }),
      } as unknown as NextRequest,
      {
        params: Promise.resolve({ id: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        time_window_end: ['終了時刻は開始時刻より後にしてください'],
      },
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('returns 403 when a trainee deletes a schedule they are not assigned to', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist_trainee' });
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      pharmacist_id: 'user_other',
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await DELETE(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('allows an admin to delete a schedule regardless of assignment', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      pharmacist_id: 'user_other',
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await DELETE(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitScheduleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'schedule_1' },
      data: { schedule_status: 'cancelled' },
    });
  });
});
