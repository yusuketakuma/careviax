import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  validateOrgReferencesMock,
  withOrgContextMock,
  visitVehicleResourceFindManyMock,
  visitVehicleResourceCreateMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  visitVehicleResourceFindManyMock: vi.fn(),
  visitVehicleResourceCreateMock: vi.fn(),
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

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

import { GET as rawGET, POST as rawPOST } from './route';

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

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/visit-vehicle-resources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin', site_id: null });
    validateOrgReferencesMock.mockResolvedValue({ ok: true });
    visitVehicleResourceFindManyMock.mockResolvedValue([]);
    visitVehicleResourceCreateMock.mockImplementation(async ({ data }) => ({
      id: 'vehicle_1',
      ...data,
    }));
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitVehicleResource: {
          findMany: visitVehicleResourceFindManyMock,
          create: visitVehicleResourceCreateMock,
        },
      }),
    );
  });

  it('lists vehicle resources filtered by site and availability', async () => {
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
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'visit_vehicle_resources_get_unhandled_error',
      undefined,
      {
        event: 'visit_vehicle_resources_get_unhandled_error',
        route: '/api/visit-vehicle-resources',
        method: 'GET',
        status: 500,
        error_name: 'Error',
      },
    );
    expect(loggerErrorMock.mock.calls[0]?.[1]).toBeUndefined();
    expect(loggerErrorMock.mock.calls[0]).not.toContain(unsafeError);
    const logged = JSON.stringify(loggerErrorMock.mock.calls);
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
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'visit_vehicle_resources_post_unhandled_error',
      undefined,
      {
        event: 'visit_vehicle_resources_post_unhandled_error',
        route: '/api/visit-vehicle-resources',
        method: 'POST',
        status: 500,
        error_name: 'Error',
      },
    );
    expect(loggerErrorMock.mock.calls[0]?.[1]).toBeUndefined();
    expect(loggerErrorMock.mock.calls[0]).not.toContain(unsafeError);
    const logged = JSON.stringify(loggerErrorMock.mock.calls);
    expect(logged).not.toContain('creation notes secret');
    expect(logged).not.toContain('VehicleResourceCreationSecretError');
  });
});
