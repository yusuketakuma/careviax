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
      timeline_events: [],
      movement_events: [],
      self_reports: [],
    });
  });

  it('passes a bounded limit to the existing timeline service', async () => {
    getPatientTimelineDataMock.mockResolvedValue({
      timeline_events: [],
      movement_events: [],
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
      timelineLimit: 5,
    });
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
