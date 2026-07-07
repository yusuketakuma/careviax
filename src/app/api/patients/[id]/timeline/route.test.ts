import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  getPatientTimelineDataMock,
  createScopedTxRunnerMock,
  fakeRunner,
  authContextMock,
  authRejectionMock,
} = vi.hoisted(() => {
  const runner = vi.fn();
  return {
    getPatientTimelineDataMock: vi.fn(),
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
    (req: Request, routeContext: { params: Promise<{ id: string }> }) => {
      const rejection = authRejectionMock();
      if (rejection) return Promise.resolve(rejection);
      return handler(req, authContextMock(), routeContext);
    },
}));

vi.mock('@/lib/db/rls', () => ({
  createScopedTxRunner: createScopedTxRunnerMock,
}));

vi.mock('@/server/services/patient-detail', () => ({
  getPatientTimelineData: getPatientTimelineDataMock,
}));

import { GET } from './route';

function createRequest(url = 'http://localhost/api/patients/patient_1/timeline') {
  return new NextRequest(url);
}

function expectMeasuredJsonContentLength(response: Response, body: unknown) {
  expect(response.headers.get('content-length')).toBe(
    String(new TextEncoder().encode(JSON.stringify(body)).length),
  );
}

describe('GET /api/patients/[id]/timeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextMock.mockReturnValue({ orgId: 'org_1', role: 'pharmacist', userId: 'user_1' });
    authRejectionMock.mockReturnValue(null);
    createScopedTxRunnerMock.mockReturnValue(fakeRunner);
  });

  it('injects the org-scoped runScoped seam into the timeline service and returns 200', async () => {
    getPatientTimelineDataMock.mockResolvedValue({
      timeline_events: [],
      self_reports: [],
    });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);

    // runScoped is built from the authenticated org id, never a free prisma client
    expect(createScopedTxRunnerMock).toHaveBeenCalledTimes(1);
    expect(createScopedTxRunnerMock).toHaveBeenCalledWith('org_1');

    // the service receives the injected runner as its first arg (the executor seam)
    expect(getPatientTimelineDataMock).toHaveBeenCalledWith(fakeRunner, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
      timelineLimit: 40,
    });

    const json = await response.json();
    expectMeasuredJsonContentLength(response, json);
    expect(json).toMatchObject({
      timeline_events: [],
      self_reports: [],
    });
  });

  it('passes a bounded timeline limit to the timeline service', async () => {
    getPatientTimelineDataMock.mockResolvedValue({
      timeline_events: [],
      self_reports: [],
    });

    const response = await GET(
      createRequest('http://localhost/api/patients/patient_1/timeline?limit=5'),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(getPatientTimelineDataMock).toHaveBeenCalledWith(fakeRunner, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
      timelineLimit: 5,
    });
  });

  it('rejects invalid timeline limits before building the scoped runner', async () => {
    const response = await GET(
      createRequest('http://localhost/api/patients/patient_1/timeline?limit=41'),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(createScopedTxRunnerMock).not.toHaveBeenCalled();
    expect(getPatientTimelineDataMock).not.toHaveBeenCalled();
  });

  it('rejects blank patient ids before building the scoped runner or calling the service', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(createScopedTxRunnerMock).not.toHaveBeenCalled();
    expect(getPatientTimelineDataMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the timeline service reports the patient is not found', async () => {
    getPatientTimelineDataMock.mockResolvedValue(null);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(createScopedTxRunnerMock).toHaveBeenCalledWith('org_1');
  });
});
