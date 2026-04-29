import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { importMhlwPriceListMock } = vi.hoisted(() => ({
  importMhlwPriceListMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest) => handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' });
  },
  isAdmin: (role: string) => role === 'admin',
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

vi.mock('@/server/services/drug-master-import/mhlw', () => ({
  importMhlwPriceList: importMhlwPriceListMock,
}));

import { POST } from './route';

describe('/api/drug-master-imports/mhlw-price', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    importMhlwPriceListMock.mockResolvedValue({
      log: { id: 'log_1', status: 'success' },
      importedCount: 55,
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx',
    });
  });

  it('imports the MHLW price workbook', async () => {
    const response = (await POST(
      {
        json: async () => ({
          workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx',
        }),
      } as NextRequest,
      { params: Promise.resolve({}) },
    ))!;

    expect(response.status).toBe(201);
    expect(importMhlwPriceListMock).toHaveBeenCalledWith(
      {},
      {
        workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx',
      },
    );
  });

  it('rejects untrusted workbook URLs before import execution', async () => {
    const response = (await POST(
      {
        json: async () => ({
          workbookUrl: 'https://127.0.0.1/internal.xlsx',
        }),
      } as NextRequest,
      { params: Promise.resolve({}) },
    ))!;

    expect(response.status).toBe(400);
    expect(importMhlwPriceListMock).not.toHaveBeenCalled();
  });

  it('rejects credential-bearing workbook URLs without echoing credentials', async () => {
    const response = (await POST(
      {
        json: async () => ({
          workbookUrl: 'https://importer:secret@www.mhlw.go.jp/topics/2026/04/xls/price.xlsx',
        }),
      } as NextRequest,
      { params: Promise.resolve({}) },
    ))!;
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(importMhlwPriceListMock).not.toHaveBeenCalled();
    expect(JSON.stringify(payload)).not.toMatch(/importer|secret/);
  });
});
