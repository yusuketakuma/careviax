import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type AuthenticatedTestRequest = NextRequest & { orgId: string; userId: string; role: string };

const {
  validateOrgReferencesMock,
  withOrgContextMock,
  visitVehicleResourceFindManyMock,
  visitVehicleResourceCreateMock,
} = vi.hoisted(() => ({
  validateOrgReferencesMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  visitVehicleResourceFindManyMock: vi.fn(),
  visitVehicleResourceCreateMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: (req: AuthenticatedTestRequest) => Promise<Response>) => {
    return (req: NextRequest) =>
      handler(
        Object.assign(req, {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'admin',
        }),
      );
  },
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

function createGetRequest(url: string) {
  return new NextRequest(url);
}

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/visit-vehicle-resources', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/visit-vehicle-resources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', { site_id: 'site_1' });
    expect(visitVehicleResourceFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        site_id: 'site_1',
        available: true,
      },
      orderBy: [{ site_id: 'asc' }, { label: 'asc' }],
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
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', { site_id: 'site_1' });
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
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitVehicleResourceCreateMock).not.toHaveBeenCalled();
  });
});
