import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  pcaPumpFindManyMock,
  pcaPumpCreateMock,
  auditLogCreateMock,
  withOrgContextMock,
  loggerErrorMock,
  allocateDisplayIdMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  pcaPumpFindManyMock: vi.fn(),
  pcaPumpCreateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  allocateDisplayIdMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    pharmacySite: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    pcaPump: {
      findMany: pcaPumpFindManyMock,
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

import { GET as rawGET, POST as rawPOST } from './route';

const GET = (req: NextRequest) => rawGET(req);
const POST = (req: NextRequest) => rawPOST(req);

function createRequest(url: string) {
  return new NextRequest(url, { headers: { 'x-org-id': 'org_1' } });
}

function createJsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/pca-pumps', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/pca-pumps', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: '{',
  });
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

const pumpRecord = {
  id: 'pump_1',
  org_id: 'org_1',
  asset_code: 'PCA-001',
  serial_number: 'SN-001',
  model_name: 'CADD Legacy PCA',
  manufacturer: null,
  status: 'available',
  maintenance_due_at: null,
  notes: null,
  created_at: new Date('2026-06-10T00:00:00.000Z'),
  updated_at: new Date('2026-06-10T00:00:00.000Z'),
  _count: { rentals: 0 },
  rentals: [],
};

function createPumpRecord(id: string, assetCode: string) {
  return {
    ...pumpRecord,
    id,
    asset_code: assetCode,
  };
}

describe('/api/pca-pumps GET', () => {
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
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin', site_id: null });
    pcaPumpFindManyMock.mockResolvedValue([pumpRecord]);
    pcaPumpCreateMock.mockResolvedValue(pumpRecord);
    allocateDisplayIdMock.mockResolvedValue('pca0000000001');
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pcaPump: {
          findMany: pcaPumpFindManyMock,
          create: pcaPumpCreateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('lists PCA pumps scoped to org and status', async () => {
    const response = await GET(createRequest('http://localhost/api/pca-pumps?status=available'));

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({ orgId: 'org_1' }),
      maxWaitMs: 10_000,
      timeoutMs: 20_000,
    });
    expect(pcaPumpFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          status: 'available',
        },
      }),
    );
    const body = await response.json();
    expect(body).toMatchObject({
      data: [{ id: 'pump_1', asset_code: 'PCA-001', maintenance_due_at: null }],
    });
    expect(body).not.toHaveProperty('meta');
    expect(pcaPumpFindManyMock.mock.calls[0]?.[0]).not.toHaveProperty('take');
  });

  it('treats blank q as an unfiltered full ledger request', async () => {
    const response = await GET(createRequest('http://localhost/api/pca-pumps?q=%20%20'));

    expect(response.status).toBe(200);
    expect(pcaPumpFindManyMock.mock.calls[0]?.[0]).not.toHaveProperty('take');
    await expect(response.json()).resolves.not.toHaveProperty('meta');
  });

  it('bounds q-filtered pump searches after DB filters', async () => {
    const response = await GET(
      createRequest('http://localhost/api/pca-pumps?q=CADD&status=available'),
    );

    expect(response.status).toBe(200);
    expect(pcaPumpFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          status: 'available',
          OR: [
            { asset_code: { contains: 'CADD', mode: 'insensitive' } },
            { serial_number: { contains: 'CADD', mode: 'insensitive' } },
            { model_name: { contains: 'CADD', mode: 'insensitive' } },
            { manufacturer: { contains: 'CADD', mode: 'insensitive' } },
          ],
        },
        orderBy: [{ status: 'asc' }, { asset_code: 'asc' }],
        take: 501,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      meta: {
        limit: 500,
        has_more: false,
      },
    });
  });

  it('trims q-filtered pump searches and reports has_more', async () => {
    pcaPumpFindManyMock.mockResolvedValue([
      createPumpRecord('pump_1', 'PCA-001'),
      createPumpRecord('pump_2', 'PCA-002'),
      createPumpRecord('pump_3', 'PCA-003'),
    ]);

    const response = await GET(createRequest('http://localhost/api/pca-pumps?q=PCA&limit=2'));

    expect(response.status).toBe(200);
    expect(pcaPumpFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 3,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'pump_1' }, { id: 'pump_2' }],
      meta: {
        limit: 2,
        has_more: true,
      },
    });
  });

  it.each([
    ['9999', 501],
    ['0', 2],
    ['abc', 501],
  ])('bounds q-filtered limit "%s" to take %i', async (limit, expectedTake) => {
    const response = await GET(
      createRequest(`http://localhost/api/pca-pumps?q=PCA&limit=${limit}`),
    );

    expect(response.status).toBe(200);
    expect(pcaPumpFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: expectedTake,
      }),
    );
  });

  it('serializes pump maintenance dates by the local pharmacy calendar day', async () => {
    pcaPumpFindManyMock.mockResolvedValue([
      {
        ...pumpRecord,
        maintenance_due_at: new Date('2026-03-02T15:30:00.000Z'),
        maintenance_events: [
          {
            id: 'event_1',
            org_id: 'org_1',
            pump_id: 'pump_1',
            performed_at: new Date('2026-03-03T04:00:00.000Z'),
            created_at: new Date('2026-03-03T04:05:00.000Z'),
            next_maintenance_due_at: new Date('2026-03-02T15:30:00.000Z'),
          },
        ],
      },
    ]);

    const response = await GET(createRequest('http://localhost/api/pca-pumps'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'pump_1',
          maintenance_due_at: '2026-03-03',
          maintenance_events: [
            expect.objectContaining({
              performed_at: '2026-03-03T04:00:00.000Z',
              created_at: '2026-03-03T04:05:00.000Z',
              next_maintenance_due_at: '2026-03-03',
            }),
          ],
        },
      ],
    });
  });

  it('rejects invalid pump status filters', async () => {
    const response = await GET(createRequest('http://localhost/api/pca-pumps?status=broken'));

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(pcaPumpFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when PCA pump listing fails unexpectedly', async () => {
    pcaPumpFindManyMock.mockRejectedValueOnce(new Error('raw PCA pump serial secret'));

    const response = await GET(createRequest('http://localhost/api/pca-pumps'));

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('serial secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'route_handler_unhandled_error',
        route: '/api/pca-pumps',
        method: 'GET',
      }),
      expect.any(Error),
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('serial secret');
  });

  it('returns no-store auth failure before parsing POST body or writing PCA pump data', async () => {
    authMock.mockResolvedValueOnce(null);

    const response = await POST(createMalformedJsonRequest());

    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(allocateDisplayIdMock).not.toHaveBeenCalled();
    expect(pcaPumpCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('records created pump maintenance due dates by the local pharmacy calendar day', async () => {
    pcaPumpCreateMock.mockResolvedValue({
      ...pumpRecord,
      display_id: 'pca0000000001',
      maintenance_due_at: new Date('2026-03-02T15:30:00.000Z'),
    });

    const response = await POST(
      createJsonRequest({
        asset_code: 'PCA-001',
        model_name: 'CADD Legacy PCA',
        maintenance_due_at: '2026-03-03',
      }),
    );

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(allocateDisplayIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pcaPump: expect.objectContaining({ create: pcaPumpCreateMock }),
        auditLog: expect.objectContaining({ create: auditLogCreateMock }),
      }),
      'PcaPump',
      'org_1',
    );
    expect(pcaPumpCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        display_id: 'pca0000000001',
        asset_code: 'PCA-001',
        model_name: 'CADD Legacy PCA',
      }),
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'pca_pump_created',
        target_type: 'PcaPump',
        target_id: 'pump_1',
        changes: expect.objectContaining({
          maintenance_due_at: '2026-03-03',
        }),
      }),
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'pump_1',
        display_id: 'pca0000000001',
        maintenance_due_at: '2026-03-03',
      },
    });
  });

  it('rejects invalid PCA pump payloads before allocating display_id', async () => {
    const response = await POST(
      createJsonRequest({
        asset_code: '',
        model_name: '',
      }),
    );

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(allocateDisplayIdMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pcaPumpCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when PCA pump creation fails unexpectedly', async () => {
    pcaPumpCreateMock.mockRejectedValueOnce(new Error('raw PCA pump creation serial secret'));

    const response = await POST(
      createJsonRequest({
        asset_code: 'PCA-001',
        model_name: 'CADD Legacy PCA',
      }),
    );

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('serial secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'route_handler_unhandled_error',
        route: '/api/pca-pumps',
        method: 'POST',
      }),
      expect.any(Error),
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('serial secret');
  });
});
