import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  updateDataExplorerRowMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  updateDataExplorerRowMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({ auth: authMock }));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: { findFirst: membershipFindFirstMock },
  },
}));

vi.mock('@/server/services/data-explorer', () => ({
  updateDataExplorerRow: updateDataExplorerRowMock,
}));

import { PATCH } from './route';

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function createRequest(url: string, body?: unknown) {
  const init: NextRequestInit = {
    method: 'PATCH',
    headers: { 'x-org-id': 'org_1', 'content-type': 'application/json' },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new NextRequest(url, init);
}

function createInvalidJsonRequest(url: string) {
  return new NextRequest(url, {
    method: 'PATCH',
    headers: { 'x-org-id': 'org_1', 'content-type': 'application/json' },
    body: 'not-json',
  } satisfies NextRequestInit);
}

describe('/api/admin/data-explorer/[table]/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
  });

  it('returns 200 on valid row update', async () => {
    const updated = { id: 'row_1', name: 'updated' };
    updateDataExplorerRowMock.mockResolvedValue(updated);

    const req = createRequest('http://localhost/api/admin/data-explorer/Patient/row_1', {
      patch: { name: 'updated' },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ table: 'Patient', id: 'row_1' }),
    });
    expect(res!.status).toBe(200);
    const json = await res!.json();
    expect(json.data.name).toBe('updated');
  });

  it('returns 400 on unknown table', async () => {
    updateDataExplorerRowMock.mockRejectedValue(new Error('Unknown table: Foo'));

    const req = createRequest('http://localhost/api/admin/data-explorer/Foo/row_1', {
      patch: { name: 'test' },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ table: 'Foo', id: 'row_1' }),
    });
    expect(res!.status).toBe(400);
  });

  it('returns 404 when row not found', async () => {
    updateDataExplorerRowMock.mockRejectedValue(new Error('Row not found'));

    const req = createRequest('http://localhost/api/admin/data-explorer/Patient/missing', {
      patch: { name: 'test' },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ table: 'Patient', id: 'missing' }),
    });
    expect(res!.status).toBe(404);
  });

  it('returns 400 on invalid body', async () => {
    const req = createInvalidJsonRequest('http://localhost/api/admin/data-explorer/Patient/row_1');
    const res = await PATCH(req, {
      params: Promise.resolve({ table: 'Patient', id: 'row_1' }),
    });
    expect(res!.status).toBe(400);
  });
});
