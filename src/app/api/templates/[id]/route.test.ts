import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  requireAuthContextMock,
  withOrgContextMock,
  templateFindFirstMock,
  templateUpdateManyMock,
  templateUpdateMock,
  templateDeleteMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  templateFindFirstMock: vi.fn(),
  templateUpdateManyMock: vi.fn(),
  templateUpdateMock: vi.fn(),
  templateDeleteMock: vi.fn(),
  loggerErrorMock: vi.fn(),
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

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: loggerErrorMock,
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

function createMalformedJsonPatchRequest() {
  return new NextRequest('http://localhost/api/templates/template_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{bad json',
  });
}

async function expectInternalError(response: Response, rawMessage: string) {
  expect(response.status).toBe(500);
  expectNoStore(response);
  const body = await response.json();
  expect(body).toMatchObject({
    code: 'INTERNAL_ERROR',
    message: 'サーバー内部でエラーが発生しました',
  });
  expect(JSON.stringify(body)).not.toContain(rawMessage);
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
      }),
    );
  });

  it('updates a template and clears other defaults when setting default', async () => {
    const response = await PATCH(
      createRequest({
        name: '更新版',
        is_default: true,
      }),
      { params: Promise.resolve({ id: '  template_1  ' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(templateUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          template_type: 'care_report',
          id: { not: 'template_1' },
        }),
      }),
    );
    expect(templateUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'template_1' },
        data: expect.objectContaining({
          name: '更新版',
          is_default: true,
        }),
      }),
    );
  });

  it('updates template metadata fields', async () => {
    const response = await PATCH(
      createRequest({
        target_role: 'physician',
        format: 'pdf',
        version: 3,
        effective_to: '2026-12-31',
        content: { blocks: ['summary', 'signature'] },
      }),
      { params: Promise.resolve({ id: 'template_1' }) },
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
          content: { blocks: ['summary', 'signature'] },
        }),
      }),
    );
  });

  it('updates a template to an important-matters document type', async () => {
    const response = await PATCH(
      createRequest({
        template_type: 'important_matters',
        name: '重要事項説明書 2026年版',
        is_default: true,
      }),
      { params: Promise.resolve({ id: 'template_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(templateUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          template_type: 'important_matters',
          id: { not: 'template_1' },
        }),
      }),
    );
    expect(templateUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          template_type: 'important_matters',
          name: '重要事項説明書 2026年版',
          is_default: true,
        }),
      }),
    );
  });

  it('rejects non-object update payloads before loading the template', async () => {
    const response = await PATCH(createRequest([]), {
      params: Promise.resolve({ id: 'template_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(templateFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(templateUpdateManyMock).not.toHaveBeenCalled();
    expect(templateUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON update payloads before loading the template', async () => {
    const response = await PATCH(createMalformedJsonPatchRequest(), {
      params: Promise.resolve({ id: 'template_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(templateFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(templateUpdateManyMock).not.toHaveBeenCalled();
    expect(templateUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects blank patch route ids before parsing or loading the template', async () => {
    const response = await PATCH(createRequest({ name: '更新版' }), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '文書テンプレートIDが不正です',
    });
    expect(templateFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(templateUpdateManyMock).not.toHaveBeenCalled();
    expect(templateUpdateMock).not.toHaveBeenCalled();
  });

  it('deletes an existing template', async () => {
    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ id: '  template_1  ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(templateDeleteMock).toHaveBeenCalledWith({
      where: { id: 'template_1' },
    });
  });

  it('returns a no-store not-found response for missing template updates', async () => {
    templateFindFirstMock.mockResolvedValue(null);

    const response = await PATCH(createRequest({ name: '更新版' }), {
      params: Promise.resolve({ id: 'template_missing' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '文書テンプレートが見つかりません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(templateUpdateMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when template update fails unexpectedly', async () => {
    const rawMessage = 'raw patch content 患者C';
    templateUpdateMock.mockRejectedValue(new Error(rawMessage));

    const response = await PATCH(createRequest({ content: { body_text: rawMessage } }), {
      params: Promise.resolve({ id: 'template_1' }),
    });

    if (!response) throw new Error('response is required');
    await expectInternalError(response, rawMessage);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'templates_id_patch_unhandled_error',
        route: '/api/templates/:id',
        method: 'PATCH',
        status: 500,
      }),
      expect.any(Error),
    );
  });

  it('returns a sanitized no-store 500 when template deletion fails unexpectedly', async () => {
    const rawMessage = 'raw delete content 患者D';
    templateDeleteMock.mockRejectedValue(new Error(rawMessage));

    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ id: 'template_1' }),
    });

    if (!response) throw new Error('response is required');
    await expectInternalError(response, rawMessage);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'templates_id_delete_unhandled_error',
        route: '/api/templates/:id',
        method: 'DELETE',
        status: 500,
      }),
      expect.any(Error),
    );
  });

  it('rejects blank delete route ids before loading the template', async () => {
    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '文書テンプレートIDが不正です',
    });
    expect(templateFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(templateDeleteMock).not.toHaveBeenCalled();
  });
});
