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

function createMalformedJsonRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/visit-preparations/brief-batch', {
    method: 'POST',
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    body: '{"schedule_ids":',
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

const brief = {
  patient: { id: 'patient_1', name: '患者A' },
  context: 'schedule',
  generated_at: '2026-03-27T00:00:00.000Z',
  last_prescribed_date: null,
  medication_changes: [],
  medications: [{ drug_name: 'ワルファリン', dose_text: '1錠' }],
  dispensing_items: [{ note: '一包化注意' }],
  multidisciplinary_updates: [{ body: '訪問看護メモ' }],
  jahis_supplemental_records: [{ raw_line: 'JAHIS RAW LINE' }],
  unresolved_items: [{ title: '未解決SOAP詳細' }],
  must_check_today: [],
  ai_summary: {
    generation_id: 'generation_1',
    provider: 'rule',
    requested_provider: 'rule',
    is_fallback: true,
    model: null,
    fallback_reason: null,
    headline: '要点なし',
    bullets: [],
    must_check_today: [],
    source_refs: [],
    generated_at: '2026-03-27T00:00:00.000Z',
    duration_ms: null,
    recent_generation_count_24h: 0,
    recent_failure_count_24h: 0,
    recent_failure_rate_24h: null,
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
          schedule_ids: [' schedule_1 ', 'schedule_2', 'schedule_1'],
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
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toEqual({
      data: {
        schedule_1: {
          ai_summary: {
            headline: '要点なし',
            must_check_today: [],
            source_refs: [],
            generated_at: '2026-03-27T00:00:00.000Z',
            provider: 'rule',
            is_fallback: true,
          },
          archive: null,
        },
        schedule_2: {
          ai_summary: {
            headline: '要点なし',
            must_check_today: [],
            source_refs: [],
            generated_at: '2026-03-27T00:00:00.000Z',
            provider: 'rule',
            is_fallback: true,
          },
          archive: null,
        },
      },
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('patient');
    expect(serialized).not.toContain('patient_1');
    expect(serialized).not.toContain('患者A');
    expect(serialized).not.toContain('medications');
    expect(serialized).not.toContain('ワルファリン');
    expect(serialized).not.toContain('dispensing_items');
    expect(serialized).not.toContain('multidisciplinary_updates');
    expect(serialized).not.toContain('jahis_supplemental_records');
    expect(serialized).not.toContain('raw_line');
    expect(serialized).not.toContain('JAHIS RAW LINE');
    expect(serialized).not.toContain('unresolved_items');
    expect(serialized).not.toContain('generation_id');
    expect(serialized).not.toContain('duration_ms');
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
    expectSensitiveNoStore(response);
  });

  it('rejects non-object batch payloads before loading schedules', async () => {
    const response = await POST(createRequest([], { 'x-org-id': 'org_1' }));

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
    expect(canAccessVisitScheduleAssignmentMock).not.toHaveBeenCalled();
    expect(scheduleVisitBriefsForSchedulesMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON batch payloads before loading schedules', async () => {
    const response = await POST(createMalformedJsonRequest({ 'x-org-id': 'org_1' }));

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
    expect(canAccessVisitScheduleAssignmentMock).not.toHaveBeenCalled();
    expect(scheduleVisitBriefsForSchedulesMock).not.toHaveBeenCalled();
  });

  it('rejects blank schedule ids before loading schedules', async () => {
    const response = await POST(
      createRequest({ schedule_ids: ['schedule_1', '   '] }, { 'x-org-id': 'org_1' }),
    );

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
    expect(canAccessVisitScheduleAssignmentMock).not.toHaveBeenCalled();
    expect(scheduleVisitBriefsForSchedulesMock).not.toHaveBeenCalled();
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
    expectSensitiveNoStore(response);
  });

  it('returns no-store auth failure before reading the body', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), { status: 401 }),
    });

    const response = await POST(
      createRequest(
        {
          schedule_ids: ['schedule_1'],
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    expect(response.status).toBe(401);
    expectSensitiveNoStore(response);
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
    expect(canAccessVisitScheduleAssignmentMock).not.toHaveBeenCalled();
    expect(scheduleVisitBriefsForSchedulesMock).not.toHaveBeenCalled();
  });

  it('returns no-store not found when any schedule brief cannot be generated', async () => {
    scheduleVisitBriefsForSchedulesMock.mockResolvedValueOnce(new Map([['schedule_1', brief]]));

    const response = await POST(
      createRequest(
        {
          schedule_ids: ['schedule_1', 'schedule_2'],
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
      message: '患者が見つかりません',
    });
  });

  it('returns a fixed no-store 500 when batch brief generation fails with PHI text', async () => {
    scheduleVisitBriefsForSchedulesMock.mockRejectedValueOnce(
      new Error('患者A ワルファリン SOAP詳細 の一括訪問要約生成に失敗しました'),
    );

    const response = await POST(
      createRequest(
        {
          schedule_ids: ['schedule_1', 'schedule_2'],
        },
        { 'x-org-id': 'org_1' },
      ),
    );

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
    expect(serialized).not.toContain('一括訪問要約生成');
  });

  it('rethrows Next.js control-flow errors instead of converting them to fixed 500', async () => {
    const redirectError = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/login;307;',
    });
    scheduleVisitBriefsForSchedulesMock.mockRejectedValueOnce(redirectError);

    await expect(
      POST(
        createRequest(
          {
            schedule_ids: ['schedule_1', 'schedule_2'],
          },
          { 'x-org-id': 'org_1' },
        ),
      ),
    ).rejects.toBe(redirectError);
  });
});
