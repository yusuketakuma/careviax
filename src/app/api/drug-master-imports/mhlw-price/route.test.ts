import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { importMhlwPriceListMock } = vi.hoisted(() => ({
  importMhlwPriceListMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' });
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
      workbookUrl: 'https://example.com/price.xlsx',
    });
  });

  it('imports the MHLW price workbook', async () => {
    const response = (await POST({
      json: async () => ({
        workbookUrl: 'https://example.com/price.xlsx',
      }),
    } as NextRequest, { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(201);
    expect(importMhlwPriceListMock).toHaveBeenCalledWith({}, {
      workbookUrl: 'https://example.com/price.xlsx',
    });
  });
});
