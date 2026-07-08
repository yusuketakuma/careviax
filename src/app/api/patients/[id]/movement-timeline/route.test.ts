import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  getPatientTimelineDataMock,
  createScopedTxRunnerMock,
  recordPhiReadAuditForRequestMock,
  fakeRunner,
  authContextMock,
  authRejectionMock,
} = vi.hoisted(() => {
  const runner = vi.fn();
  return {
    getPatientTimelineDataMock: vi.fn(),
    createScopedTxRunnerMock: vi.fn(() => runner),
    recordPhiReadAuditForRequestMock: vi.fn(),
    fakeRunner: runner,
    authContextMock: vi.fn(() => ({
      orgId: 'org_1',
      role: 'pharmacist',
      userId: 'user_1',
    })),
    authRejectionMock: vi.fn<() => Response | null>(() => null),
  };
});

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (handler: (...args: unknown[]) => Promise<Response>) =>
    (req: Request, routeContext: { params: Promise<{ id: string }> }) => {
      const rejection = authRejectionMock();
      if (rejection) return Promise.resolve(rejection);
      return handler(req, authContextMock(), routeContext);
    },
}));

vi.mock('@/lib/audit/phi-read-audit', () => ({
  recordPhiReadAuditForRequest: recordPhiReadAuditForRequestMock,
}));

vi.mock('@/lib/db/rls', () => ({
  createScopedTxRunner: createScopedTxRunnerMock,
}));

vi.mock('@/server/services/patient-detail', () => ({
  getPatientTimelineData: getPatientTimelineDataMock,
}));

import { GET } from './route';

function createRequest(url = 'http://localhost/api/patients/patient_1/movement-timeline') {
  return new NextRequest(url);
}

function expectMeasuredJsonContentLength(response: Response, body: unknown) {
  expect(response.headers.get('content-length')).toBe(
    String(new TextEncoder().encode(JSON.stringify(body)).length),
  );
}

function expectMovementListContract(body: unknown) {
  const serialized = JSON.stringify(body);
  for (const forbidden of [
    'timeline_events',
    'self_reports',
    'raw_text',
    'event_detail_href',
    'SOAP本文',
    'OCR本文',
    'patient-name-yamada.pdf',
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
}

function movementEvent(
  overrides: Partial<{
    id: string;
    category: string;
    occurred_at: string;
    title: string;
    summary: string | null;
  }> = {},
) {
  return {
    id: overrides.id ?? 'visit_b',
    event_type: 'visit_event',
    category: overrides.category ?? 'visit',
    occurred_at: overrides.occurred_at ?? '2026-06-18T00:00:00.000Z',
    recorded_at: null,
    title: overrides.title ?? '訪問記録を保存',
    summary:
      overrides.summary ??
      '訪問予定または訪問記録が登録されました。内容は訪問詳細で確認してください。',
    href: '/visits/visit_b',
    action_label: '訪問記録へ',
    status: 'completed',
    status_label: '完了',
    actor_name: null,
    actor_role: null,
    source_channel: null,
    source_label: null,
    related_entity_type: 'visit_record',
    related_entity_id: overrides.id ?? 'visit_b',
    severity: 'normal',
    badges: [],
    metadata: [],
    privacy_level: 'summary',
    raw_available: false,
  };
}

describe('GET /api/patients/[id]/movement-timeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextMock.mockReturnValue({ orgId: 'org_1', role: 'pharmacist', userId: 'user_1' });
    authRejectionMock.mockReturnValue(null);
    createScopedTxRunnerMock.mockReturnValue(fakeRunner);
  });

  it('uses the existing scoped timeline service and records a movement-specific PHI read audit', async () => {
    getPatientTimelineDataMock.mockResolvedValue({
      timeline_events: [],
      movement_events: [],
      self_reports: [],
    });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(createScopedTxRunnerMock).toHaveBeenCalledWith('org_1');
    expect(getPatientTimelineDataMock).toHaveBeenCalledWith(fakeRunner, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
      timelineLimit: 40,
    });
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      {
        patientId: 'patient_1',
        view: 'patient_movement_timeline',
      },
    );

    const json = await response.json();
    expectMeasuredJsonContentLength(response, json);
    expect(json).toMatchObject({
      movement_events: [],
      meta: {
        next_cursor: null,
        has_more: false,
        returned_count: 0,
        count_basis: 'bounded_latest_window',
        filters: { category: null, date_from: null, date_to: null },
        window_limit: 40,
      },
    });
    expect(json).not.toHaveProperty('timeline_events');
    expect(json).not.toHaveProperty('self_reports');
  });

  it('uses the fixed latest-window source read even when the response page limit is smaller', async () => {
    getPatientTimelineDataMock.mockResolvedValue({
      timeline_events: [],
      movement_events: [movementEvent({ id: 'visit_b' }), movementEvent({ id: 'visit_a' })],
      self_reports: [],
    });

    const response = await GET(
      createRequest('http://localhost/api/patients/patient_1/movement-timeline?limit=5'),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    expect(response.status).toBe(200);
    expect(getPatientTimelineDataMock).toHaveBeenCalledWith(fakeRunner, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
      timelineLimit: 40,
    });
    const json = await response.json();
    expect(json.movement_events).toHaveLength(2);
    expect(json.meta).toMatchObject({
      has_more: false,
      returned_count: 2,
      window_limit: 40,
    });
  });

  it('filters by category and JST date, pages with a non-PHI cursor, and omits legacy payload fields', async () => {
    getPatientTimelineDataMock.mockResolvedValue({
      timeline_events: [
        {
          id: 'unsafe_timeline_1',
          title: 'SOAP本文とOCR本文とpatient-name-yamada.pdfと患者電話番号090-0000-0000',
        },
      ],
      movement_events: [
        movementEvent({ id: 'visit_a', occurred_at: '2026-06-18T00:00:00.000Z' }),
        movementEvent({ id: 'visit_b', occurred_at: '2026-06-18T00:00:00.000Z' }),
        movementEvent({
          id: 'document_a',
          category: 'document',
          occurred_at: '2026-06-18T01:00:00.000Z',
          title: '報告書を作成',
        }),
        movementEvent({
          id: 'visit_next_day',
          occurred_at: '2026-06-18T16:00:00.000Z',
          title: '翌営業日の訪問',
        }),
      ],
      self_reports: [
        {
          id: 'self_report_1',
          category: 'symptom',
          relation: '本人 090-0000-0000',
          status: 'submitted',
        },
      ],
    });

    const firstResponse = await GET(
      createRequest(
        'http://localhost/api/patients/patient_1/movement-timeline?limit=1&category=visit&date_from=2026-06-18&date_to=2026-06-18',
      ),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    expect(firstResponse.status).toBe(200);
    const firstJson = await firstResponse.json();
    expect(firstJson.movement_events.map((event: { id: string }) => event.id)).toEqual(['visit_b']);
    expect(firstJson.meta).toMatchObject({
      has_more: true,
      returned_count: 1,
      count_basis: 'bounded_latest_window',
      filters: { category: 'visit', date_from: '2026-06-18', date_to: '2026-06-18' },
      window_limit: 40,
    });
    expect(typeof firstJson.meta.next_cursor).toBe('string');
    expect(JSON.stringify(firstJson.meta)).not.toContain('090-0000-0000');
    expect(JSON.stringify(firstJson.meta)).not.toContain('SOAP本文');
    expect(JSON.stringify(firstJson)).not.toContain('090-0000-0000');
    expectMovementListContract(firstJson);

    const secondResponse = await GET(
      createRequest(
        `http://localhost/api/patients/patient_1/movement-timeline?limit=1&category=visit&date_from=2026-06-18&date_to=2026-06-18&cursor=${firstJson.meta.next_cursor}`,
      ),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    expect(secondResponse.status).toBe(200);
    const secondJson = await secondResponse.json();
    expect(secondJson.movement_events.map((event: { id: string }) => event.id)).toEqual([
      'visit_a',
    ]);
    expect(secondJson.meta).toMatchObject({ has_more: false, returned_count: 1 });
  });

  it.each([
    ['invalid category', '?category=raw_text'],
    ['duplicate category', '?category=visit&category=document'],
    ['invalid date_from', '?date_from=2026-6-18'],
    ['reversed date range', '?date_from=2026-06-19&date_to=2026-06-18'],
    ['invalid cursor', '?cursor=not-a-cursor'],
  ])('rejects %s before building the scoped runner', async (_label, query) => {
    const response = await GET(
      createRequest(`http://localhost/api/patients/patient_1/movement-timeline${query}`),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    expect(response.status).toBe(400);
    expect(createScopedTxRunnerMock).not.toHaveBeenCalled();
    expect(getPatientTimelineDataMock).not.toHaveBeenCalled();
  });

  it('rejects invalid limits before building the scoped runner', async () => {
    const response = await GET(
      createRequest('http://localhost/api/patients/patient_1/movement-timeline?limit=41'),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    expect(response.status).toBe(400);
    expect(createScopedTxRunnerMock).not.toHaveBeenCalled();
    expect(getPatientTimelineDataMock).not.toHaveBeenCalled();
  });

  it('rejects blank patient ids before building the scoped runner', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    });

    expect(response.status).toBe(400);
    expect(createScopedTxRunnerMock).not.toHaveBeenCalled();
    expect(getPatientTimelineDataMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the patient is not visible to the scoped service', async () => {
    getPatientTimelineDataMock.mockResolvedValue(null);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response.status).toBe(404);
    expect(createScopedTxRunnerMock).toHaveBeenCalledWith('org_1');
  });
});
