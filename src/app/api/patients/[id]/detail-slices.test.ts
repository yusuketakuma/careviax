import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  getPatientOverviewMock,
  getPatientVisitsDataMock,
  getPatientCommunicationsDataMock,
  getPatientDocumentsDataMock,
  getPatientTimelineDataMock,
  getPatientReadinessDataMock,
  getPatientWorkflowPreviewDataMock,
  authContextMock,
  authRejectionMock,
} = vi.hoisted(() => ({
  getPatientOverviewMock: vi.fn(),
  getPatientVisitsDataMock: vi.fn(),
  getPatientCommunicationsDataMock: vi.fn(),
  getPatientDocumentsDataMock: vi.fn(),
  getPatientTimelineDataMock: vi.fn(),
  getPatientReadinessDataMock: vi.fn(),
  getPatientWorkflowPreviewDataMock: vi.fn(),
  authContextMock: vi.fn(() => ({
    orgId: 'org_1',
    role: 'pharmacist',
    userId: 'user_1',
  })),
  authRejectionMock: vi.fn<() => Response | null>(() => null),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (handler: (...args: unknown[]) => Promise<Response>) =>
    (req: Request, routeContext: { params: Promise<{ id: string }> }) => {
      const rejection = authRejectionMock();
      if (rejection) return Promise.resolve(rejection);

      return handler(req, authContextMock(), routeContext);
    },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

vi.mock('@/server/services/patient-detail', () => ({
  getPatientOverview: getPatientOverviewMock,
  getPatientVisitsData: getPatientVisitsDataMock,
  getPatientCommunicationsData: getPatientCommunicationsDataMock,
  getPatientDocumentsData: getPatientDocumentsDataMock,
  getPatientTimelineData: getPatientTimelineDataMock,
  getPatientReadinessData: getPatientReadinessDataMock,
  getPatientWorkflowPreviewData: getPatientWorkflowPreviewDataMock,
}));

import { GET as overviewGet } from './overview/route';
import { GET as visitsGet } from './visits/route';
import { GET as communicationsGet } from './communications/route';
import { GET as documentsGet } from './documents/route';
import { GET as timelineGet } from './timeline/route';
import { GET as readinessGet } from './readiness/route';
import { GET as workflowPreviewGet } from './workflow-preview/route';

type SliceRoute = (
  req: NextRequest,
  routeContext: { params: Promise<{ id: string }> },
) => Promise<Response>;

function createRequest(url: string) {
  return new NextRequest(url);
}

const sliceRoutes = [
  {
    name: 'overview',
    path: 'overview',
    get: overviewGet,
    serviceMock: getPatientOverviewMock,
    successData: { id: 'patient_1', name: '患者A' },
    expectedBody: { id: 'patient_1' },
  },
  {
    name: 'visits',
    path: 'visits',
    get: visitsGet,
    serviceMock: getPatientVisitsDataMock,
    successData: { monthly_visit_count: 2 },
    expectedBody: { monthly_visit_count: 2 },
  },
  {
    name: 'communications',
    path: 'communications',
    get: communicationsGet,
    serviceMock: getPatientCommunicationsDataMock,
    successData: {
      communication_queue: { summary: { pending_count: 1 } },
    },
    expectedBody: {
      communication_queue: { summary: { pending_count: 1 } },
    },
  },
  {
    name: 'documents',
    path: 'documents',
    get: documentsGet,
    serviceMock: getPatientDocumentsDataMock,
    successData: {
      first_visit_documents: [],
    },
    expectedBody: { first_visit_documents: [] },
  },
  {
    name: 'timeline',
    path: 'timeline',
    get: timelineGet,
    serviceMock: getPatientTimelineDataMock,
    successData: {
      timeline_events: [],
      self_reports: [],
    },
    expectedBody: {
      timeline_events: [],
      self_reports: [],
    },
  },
  {
    name: 'readiness',
    path: 'readiness',
    get: readinessGet,
    serviceMock: getPatientReadinessDataMock,
    successData: {
      applicable: true,
      overall_status: 'ready',
      completed_count: 6,
      total_count: 6,
      current_case: { id: 'case_1', status: 'active' },
      items: [],
    },
    expectedBody: {
      overall_status: 'ready',
      completed_count: 6,
    },
  },
  {
    name: 'workflow-preview',
    path: 'workflow-preview',
    get: workflowPreviewGet,
    serviceMock: getPatientWorkflowPreviewDataMock,
    successData: {
      visit_preparation: { blockers: [] },
      report_targets: [],
      communication_priority: { targets: [], warnings: [] },
    },
    expectedBody: {
      visit_preparation: { blockers: [] },
    },
  },
] satisfies Array<{
  name: string;
  path: string;
  get: SliceRoute;
  serviceMock: typeof getPatientOverviewMock;
  successData: unknown;
  expectedBody: unknown;
}>;

function callSliceRoute(
  { get, path }: (typeof sliceRoutes)[number],
  patientId = 'patient_1',
  paramId = patientId,
) {
  return get(createRequest(`http://localhost/api/patients/${patientId}/${path}`), {
    params: Promise.resolve({ id: paramId }),
  });
}

function expectNoServiceCalls() {
  for (const { serviceMock } of sliceRoutes) {
    expect(serviceMock).not.toHaveBeenCalled();
  }
}

describe('patient detail slice routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextMock.mockReturnValue({
      orgId: 'org_1',
      role: 'pharmacist',
      userId: 'user_1',
    });
    authRejectionMock.mockReturnValue(null);
  });

  it('returns patient overview data', async () => {
    getPatientOverviewMock.mockResolvedValue({ id: 'patient_1', name: '患者A' });

    const response = await overviewGet(
      createRequest('http://localhost/api/patients/patient_1/overview'),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(getPatientOverviewMock).toHaveBeenCalledWith(
      {},
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'user_1',
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: 'patient_1' });
  });

  it('returns patient visits data', async () => {
    getPatientVisitsDataMock.mockResolvedValue({ monthly_visit_count: 2 });

    const response = await visitsGet(
      createRequest('http://localhost/api/patients/patient_1/visits'),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ monthly_visit_count: 2 });
  });

  it('returns patient communications data', async () => {
    getPatientCommunicationsDataMock.mockResolvedValue({
      communication_queue: { summary: { pending_count: 1 } },
    });

    const response = await communicationsGet(
      createRequest('http://localhost/api/patients/patient_1/communications'),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      communication_queue: { summary: { pending_count: 1 } },
    });
  });

  it('returns patient documents data', async () => {
    getPatientDocumentsDataMock.mockResolvedValue({
      first_visit_documents: [],
    });

    const response = await documentsGet(
      createRequest('http://localhost/api/patients/patient_1/documents'),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ first_visit_documents: [] });
  });

  it('returns patient timeline data', async () => {
    getPatientTimelineDataMock.mockResolvedValue({
      timeline_events: [],
      self_reports: [],
    });

    const response = await timelineGet(
      createRequest('http://localhost/api/patients/patient_1/timeline'),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      timeline_events: [],
      self_reports: [],
    });
  });

  it('returns patient readiness data', async () => {
    getPatientReadinessDataMock.mockResolvedValue({
      applicable: true,
      overall_status: 'ready',
      completed_count: 6,
      total_count: 6,
      current_case: { id: 'case_1', status: 'active' },
      items: [],
    });

    const response = await readinessGet(
      createRequest('http://localhost/api/patients/patient_1/readiness'),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      overall_status: 'ready',
      completed_count: 6,
    });
  });

  it('returns patient workflow preview data', async () => {
    getPatientWorkflowPreviewDataMock.mockResolvedValue({
      visit_preparation: { blockers: [] },
      report_targets: [],
      communication_priority: { targets: [], warnings: [] },
    });

    const response = await workflowPreviewGet(
      createRequest('http://localhost/api/patients/patient_1/workflow-preview'),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      visit_preparation: { blockers: [] },
    });
  });

  it.each(sliceRoutes)(
    'returns 404 for $name when the patient detail service returns null',
    async (routeCase) => {
      routeCase.serviceMock.mockResolvedValue(null);

      const response = await callSliceRoute(routeCase);

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        code: 'WORKFLOW_NOT_FOUND',
        message: '患者が見つかりません',
      });
      expect(routeCase.serviceMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each(sliceRoutes)(
    'rejects blank patient ids before calling the $name service',
    async (routeCase) => {
      const response = await callSliceRoute(routeCase, '%20%20', '   ');

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        message: '患者IDが不正です',
      });
      expectNoServiceCalls();
    },
  );

  it.each(sliceRoutes)('passes auth context arguments to the $name service', async (routeCase) => {
    routeCase.serviceMock.mockResolvedValue(routeCase.successData);
    authContextMock.mockReturnValue({
      orgId: 'org_custom',
      role: 'admin',
      userId: 'user_custom',
    });

    const response = await callSliceRoute(routeCase, 'patient_custom');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject(routeCase.expectedBody as object);
    expect(routeCase.serviceMock).toHaveBeenCalledWith(
      {},
      {
        orgId: 'org_custom',
        patientId: 'patient_custom',
        role: 'admin',
        userId: 'user_custom',
      },
    );
  });

  it.each(sliceRoutes)(
    'does not call the $name service when auth rejects the request',
    async (routeCase) => {
      authRejectionMock.mockImplementation(() =>
        Response.json({ code: 'AUTH_FORBIDDEN', message: 'forbidden' }, { status: 403 }),
      );

      const response = await callSliceRoute(routeCase);

      expect(response.status).toBe(403);
      expectNoServiceCalls();
    },
  );
});
