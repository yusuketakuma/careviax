import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  getPatientHeaderSummaryMock,
  getPatientOverviewMock,
  getPatientVisitsDataMock,
  getPatientCommunicationsDataMock,
  getPatientDocumentsDataMock,
  getPatientHomeOperationsDataMock,
  getPatientTimelineDataMock,
  getPatientReadinessDataMock,
  getPatientWorkflowPreviewDataMock,
  authContextMock,
  authRejectionMock,
  withOrgContextMock,
  createScopedTxRunnerMock,
} = vi.hoisted(() => ({
  getPatientHeaderSummaryMock: vi.fn(),
  getPatientOverviewMock: vi.fn(),
  getPatientVisitsDataMock: vi.fn(),
  getPatientCommunicationsDataMock: vi.fn(),
  getPatientDocumentsDataMock: vi.fn(),
  getPatientHomeOperationsDataMock: vi.fn(),
  getPatientTimelineDataMock: vi.fn(),
  getPatientReadinessDataMock: vi.fn(),
  getPatientWorkflowPreviewDataMock: vi.fn(),
  authContextMock: vi.fn(() => ({
    orgId: 'org_1',
    role: 'pharmacist',
    userId: 'user_1',
  })),
  authRejectionMock: vi.fn<() => Response | null>(() => null),
  withOrgContextMock: vi.fn(
    async (_orgId: string, work: (tx: Record<string, never>) => Promise<unknown>) => work({}),
  ),
  createScopedTxRunnerMock: vi.fn(() => vi.fn()),
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

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
  createScopedTxRunner: createScopedTxRunnerMock,
}));

vi.mock('@/server/services/patient-detail', () => ({
  getPatientHeaderSummary: getPatientHeaderSummaryMock,
  getPatientOverview: getPatientOverviewMock,
  getPatientVisitsData: getPatientVisitsDataMock,
  getPatientCommunicationsData: getPatientCommunicationsDataMock,
  getPatientDocumentsData: getPatientDocumentsDataMock,
  getPatientHomeOperationsData: getPatientHomeOperationsDataMock,
  getPatientTimelineData: getPatientTimelineDataMock,
  getPatientReadinessData: getPatientReadinessDataMock,
  getPatientWorkflowPreviewData: getPatientWorkflowPreviewDataMock,
}));

import { GET as headerSummaryGet } from './header-summary/route';
import { GET as overviewGet } from './overview/route';
import { GET as visitsGet } from './visits/route';
import { GET as communicationsGet } from './communications/route';
import { GET as documentsGet } from './documents/route';
import { GET as homeOperationsGet } from './home-operations/route';
import { GET as movementTimelineGet } from './movement-timeline/route';
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
      data: {
        communication_queue: { summary: { pending_count: 1 } },
      },
    },
  },
  {
    name: 'documents',
    path: 'documents',
    get: documentsGet,
    serviceMock: getPatientDocumentsDataMock,
    successData: {
      patient: { id: 'patient_1', name: '患者A', name_kana: 'カンジャエー' },
      first_visit_documents: [],
    },
    expectedBody: {
      data: {
        patient: { id: 'patient_1', name: '患者A', name_kana: 'カンジャエー' },
        first_visit_documents: [],
      },
    },
  },
  {
    name: 'home-operations',
    path: 'home-operations',
    get: homeOperationsGet,
    serviceMock: getPatientHomeOperationsDataMock,
    successData: {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [
        {
          id: 'documents:0:未回収',
          key: 'documents',
          label: '契約・同意・書類',
          message: '未回収',
          href: '/patients/patient_1/consent',
          action_label: '書類を確認',
        },
      ],
      items: [{ key: 'documents', label: '契約・同意・書類', alerts: ['未回収'] }],
    },
    expectedBody: {
      attention_count: 1,
      top_alerts: [{ key: 'documents', message: '未回収' }],
      items: [{ key: 'documents' }],
    },
  },
  {
    name: 'movementTimeline',
    path: 'movement-timeline',
    get: movementTimelineGet,
    serviceMock: getPatientTimelineDataMock,
    successData: {
      timeline_events: [],
      movement_events: [],
      self_reports: [],
      partial_failures: [
        {
          source: 'communicationEvents',
          message: '一部のタイムライン情報を取得できませんでした',
        },
      ],
    },
    expectedBody: {
      movement_events: [],
      meta: {
        next_cursor: null,
        has_more: false,
        returned_count: 0,
        count_basis: 'bounded_latest_window',
        filters: { category: null, date_from: null, date_to: null },
        window_limit: 40,
      },
      partial_failures: [
        {
          source: 'communicationEvents',
          message: '一部のタイムライン情報を取得できませんでした',
        },
      ],
    },
    // F-003 Cycle C: the movement timeline route injects a ScopedTxRunner (a function),
    // not the global prisma client, so its first service arg is a function.
    expectedFirstArg: expect.any(Function),
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
  expectedFirstArg?: unknown;
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

function headerSummaryFixture() {
  return {
    patient_id: 'patient_1',
    name: '患者 太郎',
    name_kana: 'カンジャ タロウ',
    birth_date: '1940-01-01T00:00:00.000Z',
    gender: 'male',
    gender_label: '男性',
    care_level: 'care_3',
    care_level_label: '要介護 3',
    home_status_label: null,
    residence_label: '施設 / 201号室',
    primary_diagnosis: '2型糖尿病',
    intervention_start_date: '2026-01-01T00:00:00.000Z',
    primary_pharmacist_name: '薬剤師 花子',
    backup_pharmacist_name: '薬剤師 太郎',
    primary_staff_name: '事務 ひかり',
    backup_staff_name: '事務 まこと',
    first_visit_date: '2026-01-05T09:00:00.000Z',
    last_prescribed_date: '2026-06-01T00:00:00.000Z',
    next_prescription_expected_date: null,
    safety: {
      allergy: 'セフェム系(2019)',
      renal: 'eGFR 38(6/1)',
      handling_tags: ['narcotic', 'cold_storage', 'unit_dose'],
      swallowing: '錠剤OK・大きい錠は半割',
      cautions: ['ふらつき(6/5〜経過観察)'],
      safety_tags: ['narcotic', 'cold_storage', 'unit_dose', 'renal', 'swallowing', 'allergy'],
      visible_safety_tags: ['narcotic', 'cold_storage', 'allergy'],
      hidden_safety_tag_count: 3,
    },
  };
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
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (tx: Record<string, never>) => Promise<unknown>) => work({}),
    );
    createScopedTxRunnerMock.mockReturnValue(vi.fn());
  });

  it('returns patient header summary data', async () => {
    const headerSummary = headerSummaryFixture();
    getPatientHeaderSummaryMock.mockResolvedValue(headerSummary);

    const response = await headerSummaryGet(
      createRequest('http://localhost/api/patients/patient_1/header-summary'),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(getPatientHeaderSummaryMock).toHaveBeenCalledWith(
      {},
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'user_1',
      },
    );
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({ data: headerSummary });
  });

  it('returns no-store for invalid patient header summary ids', async () => {
    const response = await headerSummaryGet(
      createRequest('http://localhost/api/patients/%20%20/header-summary'),
      {
        params: Promise.resolve({ id: '   ' }),
      },
    );

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(getPatientHeaderSummaryMock).not.toHaveBeenCalled();
  });

  it('returns no-store when patient header summary is not found', async () => {
    getPatientHeaderSummaryMock.mockResolvedValue(null);

    const response = await headerSummaryGet(
      createRequest('http://localhost/api/patients/patient_1/header-summary'),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
      message: '患者が見つかりません',
    });
  });

  it('returns a sanitized no-store 500 when patient header summary reads fail', async () => {
    const rawError = '患者A ワルファリン header summary failure';
    getPatientHeaderSummaryMock.mockRejectedValueOnce(new Error(rawError));

    const response = await headerSummaryGet(
      createRequest('http://localhost/api/patients/patient_1/header-summary'),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(JSON.stringify(body)).not.toContain('患者A');
    expect(JSON.stringify(body)).not.toContain('ワルファリン');
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
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({ id: 'patient_1' });
  });

  it('returns no-store for invalid patient overview ids', async () => {
    const response = await overviewGet(
      createRequest('http://localhost/api/patients/%20%20/overview'),
      {
        params: Promise.resolve({ id: '   ' }),
      },
    );

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(getPatientOverviewMock).not.toHaveBeenCalled();
  });

  it('returns no-store when the patient overview is not found', async () => {
    getPatientOverviewMock.mockResolvedValue(null);

    const response = await overviewGet(
      createRequest('http://localhost/api/patients/patient_1/overview'),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
      message: '患者が見つかりません',
    });
  });

  it('returns no-store when patient overview auth rejects', async () => {
    authRejectionMock.mockImplementation(() =>
      Response.json({ code: 'AUTH_FORBIDDEN', message: 'forbidden' }, { status: 403 }),
    );

    const response = await overviewGet(
      createRequest('http://localhost/api/patients/patient_1/overview'),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(getPatientOverviewMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when patient overview reads fail', async () => {
    const rawError = 'raw patient overview read failure';
    getPatientOverviewMock.mockRejectedValueOnce(new Error(rawError));

    const response = await overviewGet(
      createRequest('http://localhost/api/patients/patient_1/overview'),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
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
      data: {
        communication_queue: { summary: { pending_count: 1 } },
      },
    });
  });

  it('returns patient documents data', async () => {
    getPatientDocumentsDataMock.mockResolvedValue({
      patient: { id: 'patient_1', name: '患者A', name_kana: 'カンジャエー' },
      first_visit_documents: [],
    });

    const response = await documentsGet(
      createRequest('http://localhost/api/patients/patient_1/documents'),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        patient: { id: 'patient_1', name: '患者A', name_kana: 'カンジャエー' },
        first_visit_documents: [],
      },
    });
  });

  it('returns patient home operations data', async () => {
    getPatientHomeOperationsDataMock.mockResolvedValue({
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [
        {
          id: 'documents:0:未回収',
          key: 'documents',
          label: '契約・同意・書類',
          message: '未回収',
          href: '/patients/patient_1/consent',
          action_label: '書類を確認',
        },
      ],
      items: [{ key: 'documents', label: '契約・同意・書類', alerts: ['未回収'] }],
    });

    const response = await homeOperationsGet(
      createRequest('http://localhost/api/patients/patient_1/home-operations'),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      attention_count: 1,
      top_alerts: [{ key: 'documents', message: '未回収' }],
      items: [{ key: 'documents' }],
    });
  });

  it('returns patient movement timeline data', async () => {
    getPatientTimelineDataMock.mockResolvedValue({
      timeline_events: [],
      movement_events: [],
      self_reports: [],
      partial_failures: [
        {
          source: 'communicationEvents',
          message: '一部のタイムライン情報を取得できませんでした',
        },
      ],
    });

    const response = await movementTimelineGet(
      createRequest('http://localhost/api/patients/patient_1/movement-timeline?limit=5'),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      movement_events: [],
      meta: {
        next_cursor: null,
        has_more: false,
        returned_count: 0,
        count_basis: 'bounded_latest_window',
        filters: { category: null, date_from: null, date_to: null },
        window_limit: 40,
      },
      partial_failures: [
        {
          source: 'communicationEvents',
          message: '一部のタイムライン情報を取得できませんでした',
        },
      ],
    });
    expect(getPatientTimelineDataMock).toHaveBeenCalledWith(expect.any(Function), {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
      timelineLimit: 40,
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
      expectSensitiveNoStore(response);
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
      expectSensitiveNoStore(response);
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
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject(routeCase.expectedBody as object);
    expect(routeCase.serviceMock).toHaveBeenCalledWith(
      'expectedFirstArg' in routeCase ? routeCase.expectedFirstArg : {},
      {
        orgId: 'org_custom',
        patientId: 'patient_custom',
        role: 'admin',
        userId: 'user_custom',
        ...(routeCase.name === 'movementTimeline' ? { timelineLimit: 40 } : {}),
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
      expectSensitiveNoStore(response);
      expectNoServiceCalls();
    },
  );

  it.each(sliceRoutes)(
    'returns a sanitized no-store 500 when the $name service fails',
    async (routeCase) => {
      const rawError = `患者A ワルファリン ${routeCase.name} failure`;
      routeCase.serviceMock.mockRejectedValueOnce(new Error(rawError));

      const response = await callSliceRoute(routeCase);

      expect(response.status).toBe(500);
      expectSensitiveNoStore(response);
      const body = await response.json();
      expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
      expect(JSON.stringify(body)).not.toContain(rawError);
      expect(JSON.stringify(body)).not.toContain('患者A');
      expect(JSON.stringify(body)).not.toContain('ワルファリン');
    },
  );
});
