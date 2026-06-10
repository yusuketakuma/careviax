import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type AuthenticatedTestRequest = NextRequest & { orgId: string; userId: string; role: string };

const { pcaPumpFindManyMock, pcaPumpCreateMock, auditLogCreateMock, withOrgContextMock } =
  vi.hoisted(() => ({
    pcaPumpFindManyMock: vi.fn(),
    pcaPumpCreateMock: vi.fn(),
    auditLogCreateMock: vi.fn(),
    withOrgContextMock: vi.fn(),
  }));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: (req: AuthenticatedTestRequest) => Promise<Response>) => handler,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    pcaPump: {
      findMany: pcaPumpFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

function withAuthContext(req: NextRequest): AuthenticatedTestRequest {
  return Object.assign(req, {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'admin',
  });
}

function createRequest(url: string): AuthenticatedTestRequest {
  return withAuthContext(new NextRequest(url));
}

function createJsonRequest(body: unknown) {
  return withAuthContext(
    new NextRequest('http://localhost/api/pca-pumps', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
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
    pcaPumpFindManyMock.mockResolvedValue([pumpRecord]);
    pcaPumpCreateMock.mockResolvedValue(pumpRecord);
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
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({ orgId: 'org_1' }),
    });
    expect(pcaPumpFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          status: 'available',
        },
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'pump_1', asset_code: 'PCA-001', maintenance_due_at: null }],
    });
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
    expect(pcaPumpFindManyMock).not.toHaveBeenCalled();
  });

  it('records created pump maintenance due dates by the local pharmacy calendar day', async () => {
    pcaPumpCreateMock.mockResolvedValue({
      ...pumpRecord,
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
        maintenance_due_at: '2026-03-03',
      },
    });
  });
});
