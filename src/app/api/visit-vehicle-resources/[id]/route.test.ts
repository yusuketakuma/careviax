import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  visitVehicleResourceFindFirstMock,
  visitVehicleResourceUpdateMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  visitVehicleResourceFindFirstMock: vi.fn(),
  visitVehicleResourceUpdateMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (
      handler: (
        req: NextRequest,
        ctx: { orgId: string; userId: string; role: string },
        routeContext: { params: Promise<{ id: string }> },
      ) => Promise<Response>,
    ) =>
    (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(
        req,
        {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'admin',
        },
        routeContext,
      ),
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

import { PATCH } from './route';

function createPatchRequest(id: string, body: unknown) {
  const req = new NextRequest(
    `http://localhost/api/visit-vehicle-resources/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  return PATCH(req, { params: Promise.resolve({ id }) });
}

describe('/api/visit-vehicle-resources/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitVehicleResourceUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects out-of-range max_stops', async () => {
    const response = await createPatchRequest('vehicle_1', { max_stops: 0 });

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the vehicle does not belong to the org', async () => {
    visitVehicleResourceFindFirstMock.mockResolvedValueOnce(null);

    const response = await createPatchRequest('vehicle_missing', { label: '軽バン9号' });

    expect(response.status).toBe(404);
    expect(visitVehicleResourceUpdateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects a blank route param', async () => {
    const response = await createPatchRequest(' ', { label: '軽バン9号' });

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });
});
