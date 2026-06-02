import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  visitScheduleFindFirstMock,
  canAccessVisitScheduleAssignmentMock,
  scheduleVisitBriefMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
  canAccessVisitScheduleAssignmentMock: vi.fn(),
  scheduleVisitBriefMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitSchedule: {
      findFirst: visitScheduleFindFirstMock,
    },
  },
}));

vi.mock('@/lib/auth/visit-schedule-access', () => ({
  canAccessVisitScheduleAssignment: canAccessVisitScheduleAssignmentMock,
}));

vi.mock('@/server/services/visit-brief', () => ({
  getScheduleVisitBrief: scheduleVisitBriefMock,
}));

import { GET } from './route';

function createRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/visit-preparations/schedule_1/brief', {
    headers,
  });
}

describe('/api/visit-preparations/[scheduleId]/brief', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      pharmacist_id: 'user_1',
      case_: {
        patient_id: 'patient_1',
        primary_pharmacist_id: 'user_1',
        backup_pharmacist_id: null,
      },
    });
    canAccessVisitScheduleAssignmentMock.mockReturnValue(true);
    scheduleVisitBriefMock.mockResolvedValue({
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
    });
  });

  it('returns schedule visit brief', async () => {
    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    expect(visitScheduleFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'schedule_1', org_id: 'org_1' },
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
    expect(scheduleVisitBriefMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_1',
      patientId: 'patient_1',
      caseIds: ['case_1'],
    });
    if (!response) throw new Error('response is required');
    await expect(response.json()).resolves.toMatchObject({
      data: {
        context: 'schedule',
      },
    });
  });

  it('trims padded schedule ids before loading the schedule', async () => {
    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: '  schedule_1  ' }),
    });

    expect(visitScheduleFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'schedule_1', org_id: 'org_1' },
      }),
    );
    expect(response.status).toBe(200);
  });

  it('rejects blank schedule ids before loading the schedule', async () => {
    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: '   ' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '訪問予定IDが不正です',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(scheduleVisitBriefMock).not.toHaveBeenCalled();
  });

  it('returns forbidden when the schedule is outside the assignment scope', async () => {
    canAccessVisitScheduleAssignmentMock.mockReturnValue(false);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    expect(scheduleVisitBriefMock).not.toHaveBeenCalled();
    expect(response.status).toBe(403);
  });
});
