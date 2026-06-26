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

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
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
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        context: 'schedule',
      },
    });
  });

  it('returns no-store auth failure before loading the schedule', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), { status: 401 }),
    });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    expect(response.status).toBe(401);
    expectSensitiveNoStore(response);
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(scheduleVisitBriefMock).not.toHaveBeenCalled();
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
    expectSensitiveNoStore(response);
  });

  it('rejects blank schedule ids before loading the schedule', async () => {
    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: '   ' }),
    });

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
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
    expectSensitiveNoStore(response);
  });

  it('returns no-store not found when the schedule is unavailable', async () => {
    visitScheduleFindFirstMock.mockResolvedValue(null);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'missing_schedule' }),
    });

    expect(scheduleVisitBriefMock).not.toHaveBeenCalled();
    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
  });

  it('returns a fixed no-store 500 when brief generation fails with PHI text', async () => {
    scheduleVisitBriefMock.mockRejectedValueOnce(
      new Error('患者A ワルファリン SOAP詳細 の訪問要約生成に失敗しました'),
    );

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('患者A');
    expect(serialized).not.toContain('ワルファリン');
    expect(serialized).not.toContain('SOAP詳細');
    expect(serialized).not.toContain('訪問要約生成');
  });

  it('rethrows Next.js control-flow errors instead of converting them to fixed 500', async () => {
    const redirectError = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/login;307;',
    });
    scheduleVisitBriefMock.mockRejectedValueOnce(redirectError);

    await expect(
      GET(createRequest({ 'x-org-id': 'org_1' }), {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      }),
    ).rejects.toBe(redirectError);
  });
});
