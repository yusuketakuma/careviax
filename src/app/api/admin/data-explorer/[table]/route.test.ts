import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthContextMock, listDataExplorerRowsMock } = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  listDataExplorerRowsMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/server/services/data-explorer', () => ({
  DATA_EXPLORER_MAX_OFFSET: 999_900,
  listDataExplorerRows: listDataExplorerRowsMock,
}));

import { GET } from './route';

function createRequest(query = '') {
  return new NextRequest(`http://localhost/api/admin/data-explorer/Patient${query}`);
}

describe('/api/admin/data-explorer/[table] GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
      rateLimit: { allowed: true, remaining: 99, resetAt: Date.now() + 1000 },
    });
    listDataExplorerRowsMock.mockResolvedValue({
      tableName: 'Patient',
      rows: [{ id: 'patient_1' }],
      columns: [],
      totalCount: 1,
      limit: 25,
      offset: 0,
    });
  });

  it('returns explorer rows for the selected table', async () => {
    const response = await GET(createRequest('?limit=10&search=花子'), {
      params: Promise.resolve({ table: 'Patient' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(listDataExplorerRowsMock).toHaveBeenCalledWith('org_1', 'Patient', {
      limit: 10,
      search: '花子',
    });
  });

  it('returns a sanitized 500 with no-store headers when the explorer query throws', async () => {
    const rawError = 'raw data-explorer read failure';
    listDataExplorerRowsMock.mockRejectedValueOnce(new Error(rawError));

    const response = await GET(createRequest(), {
      params: Promise.resolve({ table: 'Patient' }),
    });

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');

    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
  });

  it('passes through validated offset parameters', async () => {
    const response = await GET(createRequest('?limit=10&offset=20'), {
      params: Promise.resolve({ table: 'Patient' }),
    });

    expect(response.status).toBe(200);
    expect(listDataExplorerRowsMock).toHaveBeenCalledWith('org_1', 'Patient', {
      limit: 10,
      offset: 20,
      search: undefined,
    });
  });

  it('rejects malformed and oversized pagination parameters before querying rows', async () => {
    const response = await GET(createRequest('?limit=1e2&offset=999999999'), {
      params: Promise.resolve({ table: 'Patient' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(listDataExplorerRowsMock).not.toHaveBeenCalled();
  });

  it('returns validation error for unknown tables', async () => {
    listDataExplorerRowsMock.mockRejectedValue(new Error('Unknown table: NoSuchTable'));

    const response = await GET(createRequest(), {
      params: Promise.resolve({ table: 'NoSuchTable' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});
