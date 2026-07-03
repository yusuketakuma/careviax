import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  pcaPumpFindFirstMock,
  pcaPumpRefetchMock,
  pcaPumpUpdateManyMock,
  pcaPumpDeleteMock,
  pcaPumpMaintenanceEventCreateMock,
  auditLogCreateMock,
  loggerErrorMock,
  allocateDisplayIdMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  pcaPumpFindFirstMock: vi.fn(),
  pcaPumpRefetchMock: vi.fn(),
  pcaPumpUpdateManyMock: vi.fn(),
  pcaPumpDeleteMock: vi.fn(),
  pcaPumpMaintenanceEventCreateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  allocateDisplayIdMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    pcaPump: {
      findFirst: pcaPumpFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/display-id', () => ({
  allocateDisplayId: allocateDisplayIdMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

import { DELETE, PATCH } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/pca-pumps/pump_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/pca-pumps/pump_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: '{',
  });
}

function createDeleteRequest() {
  return new NextRequest('http://localhost/api/pca-pumps/pump_1', {
    method: 'DELETE',
    headers: { 'x-org-id': 'org_1' },
  });
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

const observedPumpUpdatedAt = new Date('2026-06-10T00:00:00.000Z');
const updatedPumpRecord = {
  id: 'pump_1',
  asset_code: 'PCA-001',
  serial_number: null,
  model_name: 'CADD Legacy PCA',
  manufacturer: null,
  status: 'maintenance',
  maintenance_due_at: null,
  notes: null,
  created_at: new Date('2026-06-10T00:00:00.000Z'),
  updated_at: new Date('2026-06-10T00:00:00.000Z'),
};

describe('/api/pca-pumps/[id] PATCH', () => {
  const originalTimeZone = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'Asia/Tokyo';
  });

  afterAll(() => {
    if (originalTimeZone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimeZone;
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
    });
    pcaPumpFindFirstMock.mockResolvedValue({
      id: 'pump_1',
      status: 'maintenance',
      updated_at: observedPumpUpdatedAt,
      rentals: [],
      _count: { rentals: 0 },
    });
    pcaPumpUpdateManyMock.mockResolvedValue({ count: 1 });
    pcaPumpRefetchMock.mockResolvedValue(updatedPumpRecord);
    allocateDisplayIdMock.mockResolvedValue('pcam0000000001');
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pcaPump: {
          findFirst: vi.fn((args: { select?: unknown }) =>
            args?.select ? pcaPumpFindFirstMock(args) : pcaPumpRefetchMock(args),
          ),
          updateMany: pcaPumpUpdateManyMock,
          delete: pcaPumpDeleteMock,
        },
        pcaPumpMaintenanceEvent: {
          create: pcaPumpMaintenanceEventCreateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('rejects setting a pump with open rentals to a non-rented status', async () => {
    pcaPumpFindFirstMock.mockResolvedValue({
      id: 'pump_1',
      status: 'maintenance',
      rentals: [],
      _count: { rentals: 1 },
    });

    const response = await PATCH(createRequest({ status: 'available' }), {
      params: Promise.resolve({ id: 'pump_1' }),
    });

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '未完了の貸出があるPCAポンプは利用可能・点検・退役へ変更できません',
    });
    expect(withOrgContextMock).toHaveBeenCalledTimes(1);
    expect(pcaPumpUpdateManyMock).not.toHaveBeenCalled();
  });

  it('allows maintenance status when there are no open rentals', async () => {
    const response = await PATCH(createRequest({ status: 'maintenance' }), {
      params: Promise.resolve({ id: 'pump_1' }),
    });

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledTimes(1);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({ orgId: 'org_1' }),
      maxWaitMs: 10_000,
      timeoutMs: 20_000,
    });
    expect(pcaPumpFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'pump_1', org_id: 'org_1' },
      select: {
        id: true,
        status: true,
        updated_at: true,
        rentals: {
          where: {
            status: 'returned',
            return_inspection_status: 'pending',
          },
          select: { id: true },
          take: 1,
        },
        _count: {
          select: {
            rentals: {
              where: { status: { in: ['scheduled', 'active', 'overdue'] } },
            },
          },
        },
      },
    });
    expect(pcaPumpUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'pump_1',
        org_id: 'org_1',
        status: 'maintenance',
        updated_at: observedPumpUpdatedAt,
        rentals: {
          none: { status: { in: ['scheduled', 'active', 'overdue'] } },
        },
      },
      data: expect.objectContaining({ status: 'maintenance' }),
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'pca_pump_updated',
        target_type: 'PcaPump',
        target_id: 'pump_1',
        changes: { status: 'maintenance' },
      }),
    });
  });

  it('rejects stale pump updates before maintenance event and audit side effects run', async () => {
    pcaPumpUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await PATCH(
      createRequest({
        status: 'available',
        maintenance_event_type: 'maintenance_completed',
        maintenance_result: 'available',
        maintenance_notes: '整備完了',
      }),
      { params: Promise.resolve({ id: 'pump_1' }) },
    );

    expect(response.status).toBe(409);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'PCAポンプが他の操作で更新されています。最新の状態を再読み込みしてください',
    });
    expect(pcaPumpUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'pump_1',
          org_id: 'org_1',
          status: 'maintenance',
          updated_at: observedPumpUpdatedAt,
          rentals: {
            none: {
              OR: [
                { status: { in: ['scheduled', 'active', 'overdue'] } },
                { status: 'returned', return_inspection_status: 'pending' },
              ],
            },
          },
        },
      }),
    );
    expect(pcaPumpRefetchMock).not.toHaveBeenCalled();
    expect(allocateDisplayIdMock).not.toHaveBeenCalled();
    expect(pcaPumpMaintenanceEventCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('serializes updated maintenance due dates by the local pharmacy calendar day', async () => {
    pcaPumpRefetchMock.mockResolvedValue({
      ...updatedPumpRecord,
      maintenance_due_at: new Date('2026-03-02T15:30:00.000Z'),
    });

    const response = await PATCH(createRequest({ maintenance_due_at: '2026-03-03' }), {
      params: Promise.resolve({ id: 'pump_1' }),
    });

    expect(response.status).toBe(200);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'pump_1',
        maintenance_due_at: '2026-03-03',
      },
    });
  });

  it('rejects marking a pump available while return inspection is pending', async () => {
    pcaPumpFindFirstMock.mockResolvedValue({
      id: 'pump_1',
      status: 'maintenance',
      rentals: [{ id: 'rental_1' }],
      _count: { rentals: 0 },
    });

    const response = await PATCH(createRequest({ status: 'available' }), {
      params: Promise.resolve({ id: 'pump_1' }),
    });

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '返却検品が未完了のPCAポンプは利用可能にできません',
    });
    expect(pcaPumpUpdateManyMock).not.toHaveBeenCalled();
    expect(allocateDisplayIdMock).not.toHaveBeenCalled();
    expect(pcaPumpMaintenanceEventCreateMock).not.toHaveBeenCalled();
  });

  it('records a maintenance completion event when a maintained pump becomes available', async () => {
    const response = await PATCH(
      createRequest({
        status: 'available',
        maintenance_event_type: 'maintenance_completed',
        maintenance_result: 'available',
        maintenance_notes: '整備完了',
        maintenance_due_at: '2026-12-31',
      }),
      { params: Promise.resolve({ id: 'pump_1' }) },
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(pcaPumpUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'available',
          maintenance_due_at: new Date('2026-12-31'),
        }),
      }),
    );
    expect(pcaPumpMaintenanceEventCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        display_id: 'pcam0000000001',
        pump_id: 'pump_1',
        event_type: 'maintenance_completed',
        result: 'available',
        previous_status: 'maintenance',
        next_status: 'available',
        performed_by: 'user_1',
        notes: '整備完了',
        next_maintenance_due_at: new Date('2026-12-31'),
      }),
    });
    expect(allocateDisplayIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pcaPumpMaintenanceEvent: expect.objectContaining({
          create: pcaPumpMaintenanceEventCreateMock,
        }),
      }),
      'PcaPumpMaintenanceEvent',
      'org_1',
    );
  });

  it('returns no-store auth failure before parsing PATCH body or writing PCA pump data', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), { status: 401 }),
    });

    const response = await PATCH(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'pump_1' }),
    });

    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pcaPumpUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when PCA pump update fails unexpectedly', async () => {
    pcaPumpUpdateManyMock.mockRejectedValueOnce(new Error('raw PCA pump patch serial secret'));

    const response = await PATCH(createRequest({ status: 'maintenance' }), {
      params: Promise.resolve({ id: 'pump_1' }),
    });

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('serial secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'route_handler_unhandled_error',
        route: '/api/pca-pumps/[id]',
        method: 'PATCH',
      }),
      expect.any(Error),
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('serial secret');
  });

  it('deletes a PCA pump only when it has no rental history and records an audit log', async () => {
    pcaPumpDeleteMock.mockResolvedValue({ id: 'pump_1' });

    const response = await DELETE(createDeleteRequest(), {
      params: Promise.resolve({ id: 'pump_1' }),
    });

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({ orgId: 'org_1' }),
      maxWaitMs: 10_000,
      timeoutMs: 20_000,
    });
    expect(pcaPumpDeleteMock).toHaveBeenCalledWith({ where: { id: 'pump_1' } });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'pca_pump_deleted',
        target_type: 'PcaPump',
        target_id: 'pump_1',
        changes: { id: 'pump_1' },
      }),
    });
    await expect(response.json()).resolves.toMatchObject({ data: { id: 'pump_1' } });
  });

  it('rejects deleting a PCA pump with rental history', async () => {
    pcaPumpFindFirstMock.mockResolvedValue({
      id: 'pump_1',
      _count: { rentals: 1 },
    });

    const response = await DELETE(createDeleteRequest(), {
      params: Promise.resolve({ id: 'pump_1' }),
    });

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      message: '貸出履歴があるPCAポンプは削除できません。退役に変更してください',
    });
    expect(pcaPumpDeleteMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when PCA pump delete fails unexpectedly', async () => {
    pcaPumpDeleteMock.mockRejectedValueOnce(new Error('raw PCA pump delete serial secret'));

    const response = await DELETE(createDeleteRequest(), {
      params: Promise.resolve({ id: 'pump_1' }),
    });

    expect(response.status).toBe(500);
    expectNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledTimes(1);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('serial secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'route_handler_unhandled_error',
        route: '/api/pca-pumps/[id]',
        method: 'DELETE',
      }),
      expect.any(Error),
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('serial secret');
  });
});
