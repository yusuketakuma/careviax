import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  visitScheduleFindManyMock,
  canAccessVisitScheduleAssignmentMock,
  scheduleVisitBriefsForSchedulesMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  canAccessVisitScheduleAssignmentMock: vi.fn(),
  scheduleVisitBriefsForSchedulesMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitSchedule: {
      findMany: visitScheduleFindManyMock,
    },
  },
}));

vi.mock('@/lib/auth/visit-schedule-access', () => ({
  canAccessVisitScheduleAssignment: canAccessVisitScheduleAssignmentMock,
}));

vi.mock('@/server/services/visit-brief', () => ({
  getScheduleVisitBriefsForSchedules: scheduleVisitBriefsForSchedulesMock,
}));

import { POST } from './route';

function createRequest(body: unknown, headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/visit-preparations/brief-batch', {
    method: 'POST',
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

const brief = {
  patient: { id: 'patient_1', name: '患者A' },
  context: 'schedule',
  generated_at: '2026-03-27T00:00:00.000Z',
  last_prescribed_date: null,
  medication_changes: [],
  medications: [],
  dispensing_items: [],
  multidisciplinary_updates: [],
  unresolved_items: [],
  must_check_today: [],
  ai_summary: {
    provider: 'rule',
    is_fallback: true,
    headline: '要点なし',
    bullets: [],
    must_check_today: [],
    source_refs: [],
    generated_at: '2026-03-27T00:00:00.000Z',
  },
};

describe('/api/visit-preparations/brief-batch POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    visitScheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        case_id: 'case_1',
        pharmacist_id: 'user_1',
        case_: {
          patient_id: 'patient_1',
          primary_pharmacist_id: 'user_1',
          backup_pharmacist_id: null,
        },
      },
      {
        id: 'schedule_2',
        case_id: 'case_2',
        pharmacist_id: 'user_1',
        case_: {
          patient_id: 'patient_1',
          primary_pharmacist_id: 'user_1',
          backup_pharmacist_id: null,
        },
      },
    ]);
    canAccessVisitScheduleAssignmentMock.mockReturnValue(true);
    scheduleVisitBriefsForSchedulesMock.mockResolvedValue(
      new Map([
        ['schedule_1', brief],
        ['schedule_2', brief],
      ]),
    );
  });

  it('returns schedule-keyed briefs while deduping schedule ids and patient brief generation', async () => {
    const response = await POST(
      createRequest(
        {
          schedule_ids: ['schedule_1', 'schedule_2', 'schedule_1'],
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    expect(visitScheduleFindManyMock).toHaveBeenCalledWith({
      where: {
        id: { in: ['schedule_1', 'schedule_2'] },
        org_id: 'org_1',
      },
      select: {
        id: true,
        case_id: true,
        pharmacist_id: true,
        case_: {
          select: {
            patient_id: true,
            primary_pharmacist_id: true,
            backup_pharmacist_id: true,
          },
        },
      },
    });
    expect(scheduleVisitBriefsForSchedulesMock).toHaveBeenCalledWith(expect.anything(), {
      schedules: [
        {
          scheduleId: 'schedule_1',
          orgId: 'org_1',
          patientId: 'patient_1',
          caseId: 'case_1',
        },
        {
          scheduleId: 'schedule_2',
          orgId: 'org_1',
          patientId: 'patient_1',
          caseId: 'case_2',
        },
      ],
    });
    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        schedule_1: { context: 'schedule' },
        schedule_2: { context: 'schedule' },
      },
    });
  });

  it('returns forbidden when any requested schedule is outside assignment scope', async () => {
    canAccessVisitScheduleAssignmentMock.mockReturnValueOnce(true).mockReturnValueOnce(false);

    const response = await POST(
      createRequest(
        {
          schedule_ids: ['schedule_1', 'schedule_2'],
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    expect(scheduleVisitBriefsForSchedulesMock).not.toHaveBeenCalled();
    expect(response.status).toBe(403);
  });

  it('returns not found when any requested schedule is missing from the organization', async () => {
    visitScheduleFindManyMock.mockResolvedValueOnce([
      {
        id: 'schedule_1',
        case_id: 'case_1',
        pharmacist_id: 'user_1',
        case_: {
          patient_id: 'patient_1',
          primary_pharmacist_id: 'user_1',
          backup_pharmacist_id: null,
        },
      },
    ]);

    const response = await POST(
      createRequest(
        {
          schedule_ids: ['schedule_1', 'schedule_2'],
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    expect(scheduleVisitBriefsForSchedulesMock).not.toHaveBeenCalled();
    expect(response.status).toBe(404);
  });
});
