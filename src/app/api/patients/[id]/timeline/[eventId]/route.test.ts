import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  getPatientMovementTimelineEventDetailMock,
  createScopedTxRunnerMock,
  fakeRunner,
  authContextMock,
  authRejectionMock,
} = vi.hoisted(() => {
  const runner = vi.fn();
  return {
    getPatientMovementTimelineEventDetailMock: vi.fn(),
    createScopedTxRunnerMock: vi.fn(() => runner),
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
    (req: Request, routeContext: { params: Promise<{ id: string; eventId: string }> }) => {
      const rejection = authRejectionMock();
      if (rejection) return Promise.resolve(rejection);
      return handler(req, authContextMock(), routeContext);
    },
}));

vi.mock('@/lib/db/rls', () => ({
  createScopedTxRunner: createScopedTxRunnerMock,
}));

vi.mock('@/server/services/patient-detail', () => ({
  getPatientMovementTimelineEventDetail: getPatientMovementTimelineEventDetailMock,
}));

import { GET } from './route';

function createRequest(
  url = 'http://localhost/api/patients/patient_1/timeline/visit_record%3Avisit_1',
) {
  return new NextRequest(url);
}

describe('GET /api/patients/[id]/timeline/[eventId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextMock.mockReturnValue({ orgId: 'org_1', role: 'pharmacist', userId: 'user_1' });
    authRejectionMock.mockReturnValue(null);
    createScopedTxRunnerMock.mockReturnValue(fakeRunner);
  });

  it('returns a movement-safe event detail through the org-scoped runner', async () => {
    getPatientMovementTimelineEventDetailMock.mockResolvedValue({
      patient_id: 'patient_1',
      event_id: 'visit_record:visit_1',
      event: {
        id: 'visit_record:visit_1',
        event_type: 'visit_event',
        category: 'visit',
        occurred_at: '2026-07-07T01:00:00.000Z',
        recorded_at: null,
        title: '訪問記録を保存',
        summary: '訪問予定または訪問記録が登録されました。内容は訪問詳細で確認してください。',
        href: '/visits/visit_1',
        action_label: '訪問記録を開く',
        status: 'completed',
        status_label: '完了',
        actor_name: '佐藤 薬剤師',
        actor_role: null,
        source_channel: null,
        source_label: null,
        related_entity_type: 'visit_record',
        related_entity_id: 'visit_1',
        severity: 'normal',
        badges: [{ label: '完了', tone: 'success' }],
        metadata: [],
        privacy_level: 'summary',
        raw_available: false,
      },
      destination: {
        href: '/visits/visit_1',
        label: '訪問記録を開く',
        related_entity_type: 'visit_record',
        related_entity_id: 'visit_1',
      },
      raw_text: {
        available: false,
        included: false,
        reason: 'このイベントの raw_text は resolver では提供しません。',
      },
    });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1', eventId: 'visit_record:visit_1' }),
    });

    expect(response.status).toBe(200);
    expect(createScopedTxRunnerMock).toHaveBeenCalledWith('org_1');
    expect(getPatientMovementTimelineEventDetailMock).toHaveBeenCalledWith(fakeRunner, {
      orgId: 'org_1',
      patientId: 'patient_1',
      eventId: 'visit_record:visit_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    const json = await response.json();
    expect(json).toMatchObject({
      patient_id: 'patient_1',
      event_id: 'visit_record:visit_1',
      destination: { href: '/visits/visit_1' },
      raw_text: { included: false },
    });
    expect(JSON.stringify(json)).not.toContain('SOAP本文');
    expect(JSON.stringify(json)).not.toContain('storage_key');
  });

  it('rejects invalid route params before creating the scoped runner', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: '..', eventId: 'visit_record:visit_1' }),
    });

    expect(response.status).toBe(400);
    expect(createScopedTxRunnerMock).not.toHaveBeenCalled();
    expect(getPatientMovementTimelineEventDetailMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the event is not visible in the movement timeline', async () => {
    getPatientMovementTimelineEventDetailMock.mockResolvedValue(null);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1', eventId: 'missing:event' }),
    });

    expect(response.status).toBe(404);
  });
});
