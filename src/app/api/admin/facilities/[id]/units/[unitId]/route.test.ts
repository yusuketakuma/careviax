import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  facilityUnitFindFirstMock,
  facilityUnitUpdateMock,
  facilityUnitDeleteMock,
  residenceFindFirstMock,
  createAuditLogEntryMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  facilityUnitFindFirstMock: vi.fn(),
  facilityUnitUpdateMock: vi.fn(),
  facilityUnitDeleteMock: vi.fn(),
  residenceFindFirstMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string; unitId: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    facilityUnit: {
      findFirst: facilityUnitFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

import { DELETE, PATCH } from './route';

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function createRequest(method: 'DELETE' | 'PATCH', body?: unknown) {
  const init: NextRequestInit = {
    method,
    headers: { 'content-type': 'application/json' },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new NextRequest('http://localhost/api/admin/facilities/facility_1/units/unit_1', init);
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/admin/facilities/facility_1/units/unit_1', {
    method: 'PATCH',
    body: '{bad-json',
    headers: { 'content-type': 'application/json' },
  });
}

describe('/api/admin/facilities/[id]/units/[unitId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    facilityUnitFindFirstMock.mockResolvedValue({
      id: 'unit_1',
      facility_id: 'facility_1',
      name: '2F 東',
      floor: '2F',
      unit_type: 'wing',
      capacity: 24,
      notes: null,
      display_order: 1,
    });
    facilityUnitUpdateMock.mockResolvedValue({
      id: 'unit_1',
      name: '2F 東',
      floor: '2F',
      unit_type: 'wing',
      capacity: 30,
      notes: '更新',
      display_order: 1,
      _count: { residences: 4 },
    });
    residenceFindFirstMock.mockResolvedValue(null);
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_unit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        facilityUnit: {
          findFirst: facilityUnitFindFirstMock,
          update: facilityUnitUpdateMock,
          delete: facilityUnitDeleteMock,
        },
        residence: {
          findFirst: residenceFindFirstMock,
        },
      }),
    );
  });

  it('updates a facility unit', async () => {
    const response = (await PATCH(
      createRequest('PATCH', {
        capacity: 30,
        notes: '更新',
      }),
      {
        params: Promise.resolve({ id: 'facility_1', unitId: 'unit_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function));
    expect(facilityUnitFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'unit_1', facility_id: 'facility_1', org_id: 'org_1' },
      select: {
        id: true,
        facility_id: true,
        name: true,
        floor: true,
        unit_type: true,
        capacity: true,
        notes: true,
        display_order: true,
      },
    });
    expect(facilityUnitUpdateMock).toHaveBeenCalledWith({
      where: { id: 'unit_1' },
      data: {
        capacity: 30,
        notes: '更新',
      },
      include: {
        _count: {
          select: {
            residences: { where: { is_primary: true } },
          },
        },
      },
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      {
        action: 'facility_unit_updated',
        targetType: 'FacilityUnit',
        targetId: 'unit_1',
        changes: {
          facility_id: 'facility_1',
          previous: expect.objectContaining({ capacity: 24 }),
          next: expect.objectContaining({ capacity: 30, notes: '更新' }),
        },
      },
    );
  });

  it('rejects non-object update payloads before loading the unit', async () => {
    const response = (await PATCH(createRequest('PATCH', []), {
      params: Promise.resolve({ id: 'facility_1', unitId: 'unit_1' }),
    }))!;

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(facilityUnitFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(facilityUnitUpdateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON update payloads before loading the unit', async () => {
    const response = (await PATCH(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'facility_1', unitId: 'unit_1' }),
    }))!;

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(facilityUnitFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(facilityUnitUpdateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('blocks deleting a unit that still has residents', async () => {
    residenceFindFirstMock.mockResolvedValue({ id: 'residence_1' });

    const response = (await DELETE(createRequest('DELETE'), {
      params: Promise.resolve({ id: 'facility_1', unitId: 'unit_1' }),
    }))!;

    expect(response.status).toBe(409);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者が在籍中のユニットは削除できません',
    });
    expect(facilityUnitDeleteMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('deletes a facility unit with an audit entry', async () => {
    const response = (await DELETE(createRequest('DELETE'), {
      params: Promise.resolve({ id: 'facility_1', unitId: 'unit_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(facilityUnitDeleteMock).toHaveBeenCalledWith({ where: { id: 'unit_1' } });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      {
        action: 'facility_unit_deleted',
        targetType: 'FacilityUnit',
        targetId: 'unit_1',
        changes: expect.objectContaining({
          facility_id: 'facility_1',
          name: '2F 東',
          capacity: 24,
        }),
      },
    );
  });

  it('rejects blank facility or unit route parameters before opening a transaction', async () => {
    const response = (await DELETE(createRequest('DELETE'), {
      params: Promise.resolve({ id: 'facility_1', unitId: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns a sensitive no-store internal error without leaking raw update failures', async () => {
    const rawErrorMessage = 'raw facility unit update failure';
    withOrgContextMock.mockRejectedValueOnce(new Error(rawErrorMessage));

    const response = (await PATCH(createRequest('PATCH', { notes: '更新' }), {
      params: Promise.resolve({ id: 'facility_1', unitId: 'unit_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectNoStore(response);
    await expect(response.text()).resolves.not.toContain(rawErrorMessage);
  });
});
