import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  loggerErrorMock,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  withRoutePerformanceMock,
  withOrgContextMock,
  inquiryRecordFindManyMock,
  upsertOperationalTaskMock,
} = vi.hoisted(() => ({
  loggerErrorMock: vi.fn(),
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
  withRoutePerformanceMock: vi.fn((_req, callback: () => unknown) => callback()),
  withOrgContextMock: vi.fn(),
  inquiryRecordFindManyMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
}));

const authContext = {
  orgId: 'org_1',
  userId: 'user_1',
  role: 'pharmacist' as const,
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
};

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/auth/request-context', () => ({
  runWithRequestAuthContext: runWithRequestAuthContextMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

vi.mock('@/lib/utils/performance', () => ({
  withRoutePerformance: withRoutePerformanceMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    inquiryRecord: {
      findMany: inquiryRecordFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
}));

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function createRequest(url: string) {
  return new NextRequest(url);
}

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/inquiry-records', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  } satisfies NextRequestInit);
}

function createMalformedPostRequest() {
  return new NextRequest('http://localhost/api/inquiry-records', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"cycle_id":',
  } satisfies NextRequestInit);
}

describe('/api/inquiry-records GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: authContext });
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, callback) => callback());
    inquiryRecordFindManyMock.mockResolvedValue([]);
  });

  it('filters by patient through the medication cycle relation when patient_id is provided', async () => {
    const response = await GET(
      createRequest('http://localhost/api/inquiry-records?patient_id=patient_1'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canVisit',
      message: '問い合わせ記録の閲覧権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(authContext, expect.any(Function));
    expect(inquiryRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          cycle: {
            patient_id: 'patient_1',
          },
        },
        orderBy: { inquired_at: 'desc' },
      }),
    );
    expect(inquiryRecordFindManyMock.mock.calls[0]?.[0]).not.toHaveProperty('take');
    await expect(response.json()).resolves.not.toHaveProperty('meta');
  });

  it('trims patient and cycle filters before querying inquiry records', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/inquiry-records?patient_id=%20patient_1%20&cycle_id=%20cycle_1%20',
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(inquiryRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          cycle_id: 'cycle_1',
          cycle: {
            patient_id: 'patient_1',
          },
        },
      }),
    );
  });

  it('returns clinical inquiry content with no-store headers', async () => {
    const response = await GET(createRequest('http://localhost/api/inquiry-records'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
  });

  it('returns a sanitized no-store 500 without raw logging when inquiry listing fails', async () => {
    const err = new Error('raw patient inquiry list secret');
    err.name = 'PatientInquiryListSecretError';
    inquiryRecordFindManyMock.mockRejectedValueOnce(err);

    const response = await GET(createRequest('http://localhost/api/inquiry-records'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain('raw patient inquiry list secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'inquiry_records_get_unhandled_error',
        route: '/api/inquiry-records',
        method: 'GET',
        status: 500,
      }),
      err,
    );
    const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(err);
    expect(logContext).not.toHaveProperty('error_name');
    const logContextText = JSON.stringify(logContext);
    expect(logContextText).not.toContain('raw patient inquiry list secret');
    expect(logContextText).not.toContain('PatientInquiryListSecretError');
  });

  it.each([
    ['patient_id', 'patient_id は空にできません'],
    ['cycle_id', 'cycle_id は空にできません'],
    ['status', 'status は空にできません'],
  ])('rejects blank %s filters before querying inquiry records', async (fieldName, message) => {
    const response = await GET(
      createRequest(`http://localhost/api/inquiry-records?${fieldName}=%20%20`),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '検索条件が不正です',
      details: {
        [fieldName]: [message],
      },
    });
    expect(inquiryRecordFindManyMock).not.toHaveBeenCalled();
  });

  it('filters unresolved and resolved inquiry records with explicit status contracts', async () => {
    const unresolvedResponse = await GET(
      createRequest('http://localhost/api/inquiry-records?status=unresolved'),
    );

    if (!unresolvedResponse) throw new Error('response is required');
    expect(unresolvedResponse.status).toBe(200);
    expect(inquiryRecordFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          OR: [{ result: null }, { result: 'pending' }],
        },
      }),
    );
    expect(inquiryRecordFindManyMock.mock.calls.at(-1)?.[0]).not.toHaveProperty('take');

    const resolvedResponse = await GET(
      createRequest('http://localhost/api/inquiry-records?status=resolved'),
    );

    if (!resolvedResponse) throw new Error('response is required');
    expect(resolvedResponse.status).toBe(200);
    expect(inquiryRecordFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          result: { in: ['changed', 'unchanged'] },
        },
      }),
    );
    expect(inquiryRecordFindManyMock.mock.calls.at(-1)?.[0]).not.toHaveProperty('take');
  });

  it('returns overflow metadata while keeping the extra inquiry record out of the response body', async () => {
    inquiryRecordFindManyMock.mockResolvedValueOnce(
      Array.from({ length: 3 }, (_, index) => ({ id: `inquiry_${index}` })),
    );

    const response = await GET(createRequest('http://localhost/api/inquiry-records?limit=2'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(inquiryRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 3,
      }),
    );
    const body = await response.json();
    expect(body.data).toEqual([{ id: 'inquiry_0' }, { id: 'inquiry_1' }]);
    expect(JSON.stringify(body)).not.toContain('inquiry_2');
    expect(body.meta).toEqual({ limit: 2, has_more: true });
  });

  it.each([
    ['9999', 501, 500],
    ['0', 2, 1],
    ['abc', 501, 500],
  ])('bounds limit=%s to take %i', async (rawLimit, expectedTake, expectedLimit) => {
    const response = await GET(
      createRequest(`http://localhost/api/inquiry-records?limit=${rawLimit}`),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(inquiryRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: expectedTake,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      meta: { limit: expectedLimit, has_more: false },
    });
  });

  it('rejects invalid status filters before querying inquiry records', async () => {
    const response = await GET(
      createRequest('http://localhost/api/inquiry-records?status=archived'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '検索条件が不正です',
      details: {
        status: ['status は resolved または unresolved を指定してください'],
      },
    });
    expect(inquiryRecordFindManyMock).not.toHaveBeenCalled();
  });
});

describe('/api/inquiry-records POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: authContext });
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, callback) => callback());
    upsertOperationalTaskMock.mockResolvedValue({ id: 'operational_task_1' });
  });

  it('rejects non-object create payloads before creating inquiry side effects', async () => {
    const response = await POST(createPostRequest([]));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before creating inquiry side effects', async () => {
    const response = await POST(createMalformedPostRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('denies unassigned cycles before creating inquiry side effects', async () => {
    const inquiryCreateMock = vi.fn();
    const communicationRequestCreateMock = vi.fn();
    const communicationEventCreateMock = vi.fn();
    const medicationCycleFindFirstMock = vi.fn().mockResolvedValue(null);

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        medicationCycle: {
          findFirst: medicationCycleFindFirstMock,
          update: vi.fn(),
        },
        prescriptionLine: {
          findFirst: vi.fn(),
        },
        medicationIssue: {
          findFirst: vi.fn(),
          update: vi.fn(),
        },
        inquiryRecord: {
          create: inquiryCreateMock,
        },
        communicationRequest: {
          create: communicationRequestCreateMock,
        },
        communicationEvent: {
          create: communicationEventCreateMock,
        },
      }),
    );

    const response = await POST(
      createPostRequest({
        cycle_id: 'cycle_unassigned',
        reason: '用量疑義',
        inquiry_to_physician: '在宅医',
        inquiry_content: '用量をご確認ください',
        inquired_at: '2026-03-29',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(medicationCycleFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'cycle_unassigned',
        org_id: 'org_1',
      },
      select: {
        id: true,
        overall_status: true,
        patient_id: true,
        case_id: true,
      },
    });
    expect(inquiryCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('denies line IDs that do not belong to the assigned cycle before writing', async () => {
    const inquiryCreateMock = vi.fn();
    const communicationRequestCreateMock = vi.fn();
    const prescriptionLineFindFirstMock = vi.fn().mockResolvedValue(null);

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        medicationCycle: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'cycle_1',
            overall_status: 'ready_to_dispense',
            patient_id: 'patient_1',
            case_id: 'case_1',
          }),
          update: vi.fn(),
        },
        prescriptionLine: {
          findFirst: prescriptionLineFindFirstMock,
        },
        medicationIssue: {
          findFirst: vi.fn(),
          update: vi.fn(),
        },
        inquiryRecord: {
          create: inquiryCreateMock,
        },
        communicationRequest: {
          create: communicationRequestCreateMock,
        },
        communicationEvent: {
          create: vi.fn(),
        },
      }),
    );

    const response = await POST(
      createPostRequest({
        cycle_id: 'cycle_1',
        line_id: 'line_foreign',
        reason: '用量疑義',
        inquiry_to_physician: '在宅医',
        inquiry_content: '用量をご確認ください',
        inquired_at: '2026-03-29',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(prescriptionLineFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'line_foreign',
        org_id: 'org_1',
        intake: {
          cycle_id: 'cycle_1',
        },
      },
      select: { id: true },
    });
    expect(inquiryCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('creates communication request with inquiry context snapshot', async () => {
    const inquiryCreateMock = vi.fn().mockResolvedValue({ id: 'inquiry_1' });
    const communicationRequestCreateMock = vi
      .fn()
      .mockResolvedValue({ id: 'communication_request_1' });
    const communicationEventCreateMock = vi.fn().mockResolvedValue({ id: 'event_1' });
    const medicationCycleUpdateMock = vi.fn().mockResolvedValue({ id: 'cycle_1' });
    const cycleTransitionLogCreateMock = vi.fn().mockResolvedValue({ id: 'transition_1' });
    const auditLogCreateMock = vi.fn().mockResolvedValue({ id: 'audit_1' });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        medicationCycle: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'cycle_1',
            overall_status: 'ready_to_dispense',
            patient_id: 'patient_1',
            case_id: 'case_1',
          }),
          update: medicationCycleUpdateMock,
        },
        prescriptionLine: {
          findFirst: vi.fn(),
        },
        medicationIssue: {
          findFirst: vi.fn(),
          update: vi.fn(),
        },
        inquiryRecord: {
          create: inquiryCreateMock,
        },
        communicationRequest: {
          create: communicationRequestCreateMock,
        },
        communicationEvent: {
          create: communicationEventCreateMock,
        },
        cycleTransitionLog: {
          create: cycleTransitionLogCreateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );

    const response = await POST(
      createPostRequest({
        cycle_id: 'cycle_1',
        reason: '用量疑義',
        inquiry_to_physician: '在宅医',
        inquiry_content: '用量をご確認ください',
        proposal_origin: 'pre_issuance',
        residual_adjustment: true,
        inquired_at: '2026-03-29',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canVisit',
      message: '問い合わせ記録の作成権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(authContext, expect.any(Function));
    expect(communicationRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        related_entity_type: 'inquiry_record',
        related_entity_id: 'inquiry_1',
        context_snapshot: {
          cycle_id: 'cycle_1',
          issue_id: null,
          line_id: null,
          reason: '用量疑義',
          proposal_origin: 'pre_issuance',
          residual_adjustment: true,
        },
      }),
    });
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        relatedEntityType: 'inquiry_record',
        relatedEntityId: 'inquiry_1',
        metadata: expect.objectContaining({
          communication_request_id: 'communication_request_1',
        }),
      }),
    );
    expect(medicationCycleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'cycle_1' },
      data: { overall_status: 'inquiry_pending' },
    });
    expect(cycleTransitionLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cycle_id: 'cycle_1',
        from_status: 'ready_to_dispense',
        to_status: 'inquiry_pending',
        actor_id: 'user_1',
        note: 'inquiry_record_created:inquiry_1',
      }),
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'inquiry_record_created',
        target_type: 'inquiry_record',
        target_id: 'inquiry_1',
        changes: expect.objectContaining({
          cycle_id: 'cycle_1',
          patient_id: 'patient_1',
          communication_request_id: 'communication_request_1',
        }),
      }),
    });
  });

  it('returns a sanitized no-store 500 without raw logging when inquiry creation fails', async () => {
    const err = new Error('raw patient inquiry create secret');
    err.name = 'PatientInquiryCreateSecretError';
    withOrgContextMock.mockRejectedValueOnce(err);

    const response = await POST(
      createPostRequest({
        cycle_id: 'cycle_1',
        reason: '用量疑義',
        inquiry_to_physician: '在宅医',
        inquiry_content: '用量をご確認ください',
        inquired_at: '2026-03-29',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain('raw patient inquiry create secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'inquiry_records_post_unhandled_error',
        route: '/api/inquiry-records',
        method: 'POST',
        status: 500,
      }),
      err,
    );
    const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(err);
    expect(logContext).not.toHaveProperty('error_name');
    const logContextText = JSON.stringify(logContext);
    expect(logContextText).not.toContain('raw patient inquiry create secret');
    expect(logContextText).not.toContain('PatientInquiryCreateSecretError');
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });
});
