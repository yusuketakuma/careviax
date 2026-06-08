import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type AuthenticatedTestRequest = NextRequest & { orgId: string; userId: string; role: string };

const { pcaPumpFindManyMock, pcaPumpCreateMock, withOrgContextMock } = vi.hoisted(() => ({
  pcaPumpFindManyMock: vi.fn(),
  pcaPumpCreateMock: vi.fn(),
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

import { GET } from './route';

function createRequest(url: string): AuthenticatedTestRequest {
  return Object.assign(new NextRequest(url), {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'admin',
  });
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

  it('rejects invalid pump status filters', async () => {
    const response = await GET(createRequest('http://localhost/api/pca-pumps?status=broken'));

    expect(response.status).toBe(400);
    expect(pcaPumpFindManyMock).not.toHaveBeenCalled();
  });
});
