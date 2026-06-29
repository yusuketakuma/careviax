import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  withOrgContextMock,
  visitVehicleResourceFindFirstMock,
  visitVehicleResourceUpdateMock,
  createAuditLogEntryMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  visitVehicleResourceFindFirstMock: vi.fn(),
  visitVehicleResourceUpdateMock: vi.fn(),
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

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

import { PATCH } from './route';

function createPatchRequest(id: string, body: unknown) {
  const req = new NextRequest(
    `http://localhost/api/visit-vehicle-resources/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
      body: JSON.stringify(body),
    },
  );
  return PATCH(req, { params: Promise.resolve({ id }) });
}

function createMalformedPatchRequest(id: string) {
  const req = new NextRequest(
    `http://localhost/api/visit-vehicle-resources/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
      body: '{',
    },
  );
  return PATCH(req, { params: Promise.resolve({ id }) });
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/visit-vehicle-resources/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin', site_id: null });
    visitVehicleResourceFindFirstMock.mockResolvedValue({ id: 'vehicle_1' });
    visitVehicleResourceUpdateMock.mockImplementation(async ({ where, data }) => ({
      id: where.id,
      ...data,
    }));
    createAuditLogEntryMock.mockResolvedValue(undefined);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitVehicleResource: {
          findFirst: visitVehicleResourceFindFirstMock,
          update: visitVehicleResourceUpdateMock,
        },
      }),
    );
  });

  it('updates a vehicle resource with normalized fields and records an audit log', async () => {
    const response = await createPatchRequest('vehicle_1', {
      label: ' 軽バン1号 ',
      vehicle_code: '',
      travel_mode: 'BICYCLE',
      max_stops: 4,
      available: false,
      notes: ' 点検期限 6/21 ',
    });

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      }),
      maxWaitMs: 10_000,
      timeoutMs: 20_000,
    });
    expect(visitVehicleResourceFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'vehicle_1', org_id: 'org_1' },
      select: { id: true },
    });
    expect(visitVehicleResourceUpdateMock).toHaveBeenCalledWith({
      where: { id: 'vehicle_1' },
      data: {
        label: '軽バン1号',
        vehicle_code: null,
        travel_mode: 'BICYCLE',
        max_stops: 4,
        available: false,
        notes: '点検期限 6/21',
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
      expect.objectContaining({
        action: 'visit_vehicle_resource_updated',
        targetType: 'VisitVehicleResource',
        targetId: 'vehicle_1',
      }),
    );
  });

  it('keeps omitted fields untouched in the update payload', async () => {
    const response = await createPatchRequest('vehicle_1', { available: true });

    expect(response.status).toBe(200);
    expect(visitVehicleResourceUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { available: true },
      }),
    );
  });

  it('rejects an empty update payload', async () => {
    const response = await createPatchRequest('vehicle_1', {});

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitVehicleResourceUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects out-of-range max_stops', async () => {
    const response = await createPatchRequest('vehicle_1', { max_stops: 0 });

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the vehicle does not belong to the org', async () => {
    visitVehicleResourceFindFirstMock.mockResolvedValueOnce(null);

    const response = await createPatchRequest('vehicle_missing', { label: '軽バン9号' });

    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(visitVehicleResourceUpdateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects a blank route param', async () => {
    const response = await createPatchRequest(' ', { label: '軽バン9号' });

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns no-store auth failure before parsing PATCH body or updating vehicle resources', async () => {
    authMock.mockResolvedValueOnce(null);

    const response = await createMalformedPatchRequest('vehicle_1');

    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitVehicleResourceUpdateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when vehicle resource update fails unexpectedly', async () => {
    const unsafeError = new Error('raw vehicle resource patch notes secret');
    unsafeError.name = 'VisitVehiclePatchSecretError';
    visitVehicleResourceUpdateMock.mockRejectedValueOnce(unsafeError);

    const response = await createPatchRequest('vehicle_1', { notes: '患者宅への訪問車両メモ' });

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('patch notes secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'visit_vehicle_resources_id_patch_unhandled_error',
      undefined,
      {
        event: 'visit_vehicle_resources_id_patch_unhandled_error',
        route: '/api/visit-vehicle-resources/[id]',
        method: 'PATCH',
        status: 500,
        error_name: 'Error',
      },
    );
    expect(loggerErrorMock.mock.calls[0]?.[1]).toBeUndefined();
    expect(loggerErrorMock.mock.calls[0]).not.toContain(unsafeError);
    const logged = JSON.stringify(loggerErrorMock.mock.calls);
    expect(logged).not.toContain('patch notes secret');
    expect(logged).not.toContain('VisitVehiclePatchSecretError');
  });
});
