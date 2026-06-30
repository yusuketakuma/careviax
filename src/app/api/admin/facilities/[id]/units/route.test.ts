import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  facilityFindFirstMock,
  facilityUnitFindManyMock,
  facilityUnitCreateMock,
  createAuditLogEntryMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  facilityFindFirstMock: vi.fn(),
  facilityUnitFindManyMock: vi.fn(),
  facilityUnitCreateMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    facility: {
      findFirst: facilityFindFirstMock,
    },
    facilityUnit: {
      findMany: facilityUnitFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

import { GET, POST } from './route';

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function createRequest(body?: unknown) {
  const init: NextRequestInit = {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new NextRequest('http://localhost/api/admin/facilities/facility_1/units', init);
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/admin/facilities/facility_1/units', {
    method: 'POST',
    body: '{bad-json',
    headers: { 'content-type': 'application/json' },
  });
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/admin/facilities/[id]/units', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    facilityFindFirstMock.mockResolvedValue({ id: 'facility_1' });
    facilityUnitFindManyMock.mockResolvedValue([
      {
        id: 'unit_1',
        name: '2F 東',
        floor: '2F',
        unit_type: 'wing',
        capacity: 24,
        notes: null,
        display_order: 1,
        _count: { residences: 3 },
      },
    ]);
    facilityUnitCreateMock.mockResolvedValue({
      id: 'unit_2',
      name: '3F 西',
      floor: '3F',
      unit_type: 'wing',
      capacity: 18,
      notes: null,
      display_order: 2,
    });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_unit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        facility: {
          findFirst: facilityFindFirstMock,
        },
        facilityUnit: {
          create: facilityUnitCreateMock,
        },
      }),
    );
  });

  it('lists facility units', async () => {
    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'facility_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'unit_1', name: '2F 東', patient_count: 3 }],
    });
  });

  it('creates a facility unit', async () => {
    const response = (await POST(
      createRequest({
        name: '3F 西',
        floor: '3F',
        unit_type: 'wing',
        capacity: 18,
        display_order: 2,
      }),
      {
        params: Promise.resolve({ id: 'facility_1' }),
      },
    ))!;

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function));
    expect(facilityUnitCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        facility_id: 'facility_1',
        name: '3F 西',
        floor: '3F',
        unit_type: 'wing',
      }),
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      {
        action: 'facility_unit_created',
        targetType: 'FacilityUnit',
        targetId: 'unit_2',
        changes: expect.objectContaining({
          facility_id: 'facility_1',
          name: '3F 西',
          unit_type: 'wing',
        }),
      },
    );
  });

  it('rejects non-object create payloads before loading the facility', async () => {
    const response = (await POST(createRequest([]), {
      params: Promise.resolve({ id: 'facility_1' }),
    }))!;

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(facilityFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(facilityUnitCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before loading the facility', async () => {
    const response = (await POST(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'facility_1' }),
    }))!;

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(facilityFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(facilityUnitCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns a sensitive no-store internal error without leaking raw failure details', async () => {
    const rawErrorMessage = 'raw facility unit create failure';
    withOrgContextMock.mockRejectedValueOnce(new Error(rawErrorMessage));

    const response = (await POST(
      createRequest({
        name: '3F 西',
        unit_type: 'wing',
      }),
      {
        params: Promise.resolve({ id: 'facility_1' }),
      },
    ))!;

    expect(response.status).toBe(500);
    expectNoStore(response);
    await expect(response.text()).resolves.not.toContain(rawErrorMessage);
  });
});
