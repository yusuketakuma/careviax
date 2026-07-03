import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  validateOrgReferencesMock,
  withOrgContextMock,
  visitVehicleResourceCountMock,
  visitVehicleResourceFindManyMock,
  visitVehicleResourceCreateMock,
  createAuditLogEntryMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  visitVehicleResourceCountMock: vi.fn(),
  visitVehicleResourceFindManyMock: vi.fn(),
  visitVehicleResourceCreateMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
  },
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

import { GET as rawGET, POST as rawPOST } from './route';
import { expectNoStore } from '@/test/api-response-assertions';

const emptyRouteContext = { params: Promise.resolve({}) };

const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createGetRequest(url: string) {
  return new NextRequest(url, { headers: { 'x-org-id': 'org_1' } });
}

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/visit-vehicle-resources', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: JSON.stringify(body),
  });
}

function createMalformedPostRequest() {
  return new NextRequest('http://localhost/api/visit-vehicle-resources', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: '{',
  });
}

describe('/api/visit-vehicle-resources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin', site_id: null });
    validateOrgReferencesMock.mockResolvedValue({ ok: true });
    visitVehicleResourceCountMock.mockResolvedValue(0);
    visitVehicleResourceFindManyMock.mockResolvedValue([]);
    visitVehicleResourceCreateMock.mockImplementation(async ({ data }) => ({
      id: 'vehicle_1',
      ...data,
    }));
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitVehicleResource: {
          count: visitVehicleResourceCountMock,
          findMany: visitVehicleResourceFindManyMock,
          create: visitVehicleResourceCreateMock,
        },
      }),
    );
  });

  it('lists vehicle resources filtered by site and availability', async () => {
    visitVehicleResourceCountMock.mockResolvedValueOnce(1);
    visitVehicleResourceFindManyMock.mockResolvedValueOnce([
      {
        id: 'vehicle_1',
        org_id: 'org_1',
        site_id: 'site_1',
        label: '社用車A',
        available: true,
        site: { id: 'site_1', name: '本店' },
      },
    ]);

    const response = await GET(
      createGetRequest(
        'http://localhost/api/visit-vehicle-resources?site_id=site_1&available=true',
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', { site_id: 'site_1' });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      }),
      maxWaitMs: 10_000,
      timeoutMs: 20_000,
    });
    expect(visitVehicleResourceCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        site_id: 'site_1',
        available: true,
      },
    });
    expect(visitVehicleResourceFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        site_id: 'site_1',
        available: true,
      },
      orderBy: [{ site_id: 'asc' }, { label: 'asc' }],
      take: 100,
      include: {
        site: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    const body = await response.json();
    expect(Object.keys(body)).toEqual([
      'data',
      'total_count',
      'visible_count',
      'hidden_count',
      'truncated',
      'count_basis',
      'filters_applied',
      'limit',
    ]);
    expect(body).toMatchObject({
      data: [expect.objectContaining({ id: 'vehicle_1', label: '社用車A' })],
      total_count: 1,
      visible_count: 1,
      hidden_count: 0,
      truncated: false,
      count_basis: 'visit_vehicle_resources',
      filters_applied: { site_id: 'site_1', available: true },
      limit: 100,
    });
  });

  it('bounds vehicle resource list size when a limit is provided', async () => {
    const response = await GET(
      createGetRequest('http://localhost/api/visit-vehicle-resources?available=true&limit=5'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitVehicleResourceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          available: true,
        },
        take: 5,
      }),
    );
  });

  it('clamps overly large vehicle resource list limits', async () => {
    const response = await GET(
      createGetRequest('http://localhost/api/visit-vehicle-resources?limit=9999'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitVehicleResourceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 200,
      }),
    );
  });

  it('returns counted metadata when the bounded vehicle resource list is truncated', async () => {
    visitVehicleResourceCountMock.mockResolvedValueOnce(3);
    visitVehicleResourceFindManyMock.mockResolvedValueOnce([
      {
        id: 'vehicle_1',
        org_id: 'org_1',
        site_id: 'site_1',
        label: '社用車A',
        available: true,
        site: { id: 'site_1', name: '本店' },
      },
    ]);

    const response = await GET(
      createGetRequest('http://localhost/api/visit-vehicle-resources?available=true&limit=1'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ id: 'vehicle_1' })],
      total_count: 3,
      visible_count: 1,
      hidden_count: 2,
      truncated: true,
      count_basis: 'visit_vehicle_resources',
      filters_applied: { available: true },
      limit: 1,
    });
  });

  it('rejects blank site filters before reference checks or DB access', async () => {
    const response = await GET(
      createGetRequest('http://localhost/api/visit-vehicle-resources?site_id=%20%20'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitVehicleResourceFindManyMock).not.toHaveBeenCalled();
  });

  it('returns no-store auth failure before vehicle resource reads', async () => {
    authMock.mockResolvedValueOnce(null);

    const response = await GET(createGetRequest('http://localhost/api/visit-vehicle-resources'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitVehicleResourceFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when vehicle resource lookup fails unexpectedly', async () => {
    const unsafeError = new Error('raw visit vehicle resource route notes secret');
    unsafeError.name = 'VisitVehicleResourceSecretError';
    visitVehicleResourceFindManyMock.mockRejectedValueOnce(unsafeError);

    const response = await GET(createGetRequest('http://localhost/api/visit-vehicle-resources'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('route notes secret');
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'visit_vehicle_resources_get_unhandled_error',
        route: '/api/visit-vehicle-resources',
        method: 'GET',
        status: 500,
      },
      unsafeError,
    );
    const loggedContext = loggerErrorMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(loggedContext).not.toHaveProperty('error_name');
    const logged = JSON.stringify(loggedContext);
    expect(logged).not.toContain('route notes secret');
    expect(logged).not.toContain('VisitVehicleResourceSecretError');
  });

  it('creates a vehicle resource with normalized optional fields', async () => {
    const response = await POST(
      createPostRequest({
        site_id: ' site_1 ',
        label: ' 社用車A ',
        vehicle_code: ' car-1 ',
        travel_mode: 'DRIVE',
        max_stops: 6,
        max_route_duration_minutes: 180,
        available: true,
        next_inspection_date: '2026-07-31',
        notes: ' 軽自動車 ',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', { site_id: 'site_1' });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      }),
      maxWaitMs: 10_000,
      timeoutMs: 20_000,
    });
    expect(visitVehicleResourceCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        site_id: 'site_1',
        label: '社用車A',
        vehicle_code: 'car-1',
        travel_mode: 'DRIVE',
        max_stops: 6,
        max_route_duration_minutes: 180,
        available: true,
        next_inspection_date: new Date('2026-07-31'),
        notes: '軽自動車',
      },
      include: {
        site: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      {
        action: 'visit_vehicle_resource_created',
        targetType: 'VisitVehicleResource',
        targetId: 'vehicle_1',
        changes: {
          site_id: 'site_1',
          label: '社用車A',
          vehicle_code: 'car-1',
          travel_mode: 'DRIVE',
          max_stops: 6,
          max_route_duration_minutes: 180,
          available: true,
          next_inspection_date: '2026-07-31',
          notes_present: true,
        },
      },
    );
  });

  it('rejects invalid vehicle inspection dates before reference checks', async () => {
    const response = await POST(
      createPostRequest({
        site_id: 'site_1',
        label: '社用車A',
        next_inspection_date: '2026-13-99',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitVehicleResourceCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects invalid vehicle resource payloads before reference checks', async () => {
    const response = await POST(
      createPostRequest({
        site_id: 'site_1',
        label: '社用車A',
        max_stops: 0,
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitVehicleResourceCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns no-store auth failure before parsing POST body or writing vehicle resources', async () => {
    authMock.mockResolvedValueOnce(null);

    const response = await POST(createMalformedPostRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitVehicleResourceCreateMock).not.toHaveBeenCalled();
  });

  it('rejects vehicle resources for unknown sites', async () => {
    validateOrgReferencesMock.mockResolvedValueOnce({
      ok: false,
      response: new Response(
        JSON.stringify({ code: 'VALIDATION_ERROR', message: '指定された店舗が見つかりません' }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    });

    const response = await POST(
      createPostRequest({
        site_id: 'site_missing',
        label: '社用車A',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitVehicleResourceCreateMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when vehicle resource creation fails unexpectedly', async () => {
    const unsafeError = new Error('raw vehicle resource creation notes secret');
    unsafeError.name = 'VehicleResourceCreationSecretError';
    visitVehicleResourceCreateMock.mockRejectedValueOnce(unsafeError);

    const response = await POST(
      createPostRequest({
        site_id: 'site_1',
        label: '社用車A',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('creation notes secret');
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'visit_vehicle_resources_post_unhandled_error',
        route: '/api/visit-vehicle-resources',
        method: 'POST',
        status: 500,
      },
      unsafeError,
    );
    const loggedContext = loggerErrorMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(loggedContext).not.toHaveProperty('error_name');
    const logged = JSON.stringify(loggedContext);
    expect(logged).not.toContain('creation notes secret');
    expect(logged).not.toContain('VehicleResourceCreationSecretError');
  });
});
