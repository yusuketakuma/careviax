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
import { expectNoStore } from '@/test/api-response-assertions';

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

const existingVehicleResource = {
  id: 'vehicle_1',
  site_id: 'site_1',
  label: '旧軽バン',
  vehicle_code: 'old-car-1',
  travel_mode: 'DRIVE',
  max_stops: 8,
  max_route_duration_minutes: 240,
  available: true,
  next_inspection_date: null,
  notes: '旧メモ',
};

describe('/api/visit-vehicle-resources/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin', site_id: null });
    visitVehicleResourceFindFirstMock.mockResolvedValue(existingVehicleResource);
    visitVehicleResourceUpdateMock.mockImplementation(async ({ where, data }) => ({
      ...existingVehicleResource,
      id: where.id,
      ...data,
      site: { id: 'site_1', name: '本店' },
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
      next_inspection_date: '2026-06-21',
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
      select: {
        id: true,
        site_id: true,
        label: true,
        vehicle_code: true,
        travel_mode: true,
        max_stops: true,
        max_route_duration_minutes: true,
        available: true,
        next_inspection_date: true,
        notes: true,
      },
    });
    expect(visitVehicleResourceUpdateMock).toHaveBeenCalledWith({
      where: { id: 'vehicle_1' },
      data: {
        label: '軽バン1号',
        vehicle_code: null,
        travel_mode: 'BICYCLE',
        max_stops: 4,
        available: false,
        next_inspection_date: new Date('2026-06-21'),
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
        changes: {
          label: { from: '旧軽バン', to: '軽バン1号' },
          vehicle_code: { from: 'old-car-1', to: null },
          travel_mode: { from: 'DRIVE', to: 'BICYCLE' },
          max_stops: { from: 8, to: 4 },
          available: { from: true, to: false },
          next_inspection_date: { from: null, to: '2026-06-21' },
          notes: { changed: true, from_present: true, to_present: true },
        },
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
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('updates only the inspection date without treating the payload as empty', async () => {
    const response = await createPatchRequest('vehicle_1', { next_inspection_date: '' });

    expect(response.status).toBe(200);
    expect(visitVehicleResourceUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { next_inspection_date: null },
      }),
    );
  });

  it('rejects an empty update payload', async () => {
    const response = await createPatchRequest('vehicle_1', {});

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toEqual({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {},
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitVehicleResourceUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON PATCH bodies with the body validation contract', async () => {
    const response = await createMalformedPatchRequest('vehicle_1');

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toEqual({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitVehicleResourceUpdateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
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
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'visit_vehicle_resources_id_patch_unhandled_error',
        route: '/api/visit-vehicle-resources/[id]',
        method: 'PATCH',
        status: 500,
      },
      unsafeError,
    );
    const loggedContext = loggerErrorMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(loggedContext).not.toHaveProperty('error_name');
    const logged = JSON.stringify(loggedContext);
    expect(logged).not.toContain('patch notes secret');
    expect(logged).not.toContain('VisitVehiclePatchSecretError');
  });
});
