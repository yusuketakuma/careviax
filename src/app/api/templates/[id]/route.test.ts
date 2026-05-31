import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  templateFindFirstMock,
  templateUpdateManyMock,
  templateUpdateMock,
  templateDeleteMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  templateFindFirstMock: vi.fn(),
  templateUpdateManyMock: vi.fn(),
  templateUpdateMock: vi.fn(),
  templateDeleteMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    template: {
      findFirst: templateFindFirstMock,
    },
  },
}));

import { DELETE, PATCH } from './route';

function createRequest(body?: unknown) {
  return new NextRequest('http://localhost/api/templates/template_1', {
    method: body === undefined ? 'DELETE' : 'PATCH',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('/api/templates/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
    });
    templateFindFirstMock.mockResolvedValue({
      id: 'template_1',
      template_type: 'care_report',
    });
    templateUpdateManyMock.mockResolvedValue({ count: 1 });
    templateUpdateMock.mockResolvedValue({ id: 'template_1', is_default: true });
    templateDeleteMock.mockResolvedValue({ id: 'template_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        template: {
          updateMany: templateUpdateManyMock,
          update: templateUpdateMock,
          delete: templateDeleteMock,
        },
      })
    );
  });

  it('updates a template and clears other defaults when setting default', async () => {
    const response = await PATCH(
      createRequest({
        name: '更新版',
        is_default: true,
      }),
      { params: Promise.resolve({ id: 'template_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(templateUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          template_type: 'care_report',
          id: { not: 'template_1' },
        }),
      })
    );
    expect(templateUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'template_1' },
        data: expect.objectContaining({
          name: '更新版',
          is_default: true,
        }),
      })
    );
  });

  it('updates template metadata fields', async () => {
    const response = await PATCH(
      createRequest({
        target_role: 'physician',
        format: 'pdf',
        version: 3,
        effective_to: '2026-12-31',
      }),
      { params: Promise.resolve({ id: 'template_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(templateUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          target_role: 'physician',
          format: 'pdf',
          version: 3,
          effective_to: new Date('2026-12-31T00:00:00.000Z'),
        }),
      })
    );
  });

  it('deletes an existing template', async () => {
    const response = await DELETE(
      createRequest(),
      { params: Promise.resolve({ id: 'template_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(templateDeleteMock).toHaveBeenCalledWith({
      where: { id: 'template_1' },
    });
  });
});
