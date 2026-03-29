import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  importMhlwGenericFlagsMock,
  importGenericNameMappingsMock,
} = vi.hoisted(() => ({
  importMhlwGenericFlagsMock: vi.fn(),
  importGenericNameMappingsMock: vi.fn(),
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
  importMhlwGenericFlags: importMhlwGenericFlagsMock,
  importGenericNameMappings: importGenericNameMappingsMock,
}));

import { POST } from './route';

describe('/api/drug-master-imports/mhlw-generic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    importMhlwGenericFlagsMock.mockResolvedValue({
      log: { id: 'log_flags', status: 'success' },
      importedCount: 10,
      workbookUrl: 'https://example.com/generic.xlsx',
    });
    importGenericNameMappingsMock.mockResolvedValue({
      log: { id: 'log_mappings', status: 'success' },
      importedCount: 20,
      workbookUrl: 'https://example.com/generic.xlsx',
    });
  });

  it('imports both generic flags and mappings in all mode', async () => {
    const response = (await POST({
      json: async () => ({
        mode: 'all',
        workbookUrl: 'https://example.com/generic.xlsx',
      }),
    } as NextRequest, { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(201);
    expect(importMhlwGenericFlagsMock).toHaveBeenCalled();
    expect(importGenericNameMappingsMock).toHaveBeenCalled();
  });
});
