import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
    pharmacySite: { findFirst: vi.fn() },
    pharmacyDrugStock: { findMany: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/pharmacy-drug-stocks/review', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/pharmacy-drug-stocks/review', {
    method: 'POST',
    body: '{"site_id":',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

describe('/api/pharmacy-drug-stocks/review', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.pharmacySite.findFirst.mockResolvedValue({ id: 'site_1', name: '本店' });
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit_1' });
    prismaMock.$transaction.mockImplementation((callback) =>
      callback({
        pharmacyDrugStock: prismaMock.pharmacyDrugStock,
        auditLog: prismaMock.auditLog,
      }),
    );
  });

  it('rejects non-object request bodies before looking up the site', async () => {
    const response = await POST(createRequest(['unexpected']), {
      params: Promise.resolve({}),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before looking up the site', async () => {
    const response = await POST(createMalformedJsonRequest(), {
      params: Promise.resolve({}),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});
