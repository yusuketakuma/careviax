import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  requireAuthContextMock,
  withOrgContextMock,
  templateFindFirstMock,
  templateUpdateManyMock,
  templateDeleteManyMock,
  acquireAdvisoryTxLockMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  templateFindFirstMock: vi.fn(),
  templateUpdateManyMock: vi.fn(),
  templateDeleteManyMock: vi.fn(),
  acquireAdvisoryTxLockMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: string },
      routeContext: { params: Promise<{ id: string }> },
    ) => Promise<Response>,
    options: unknown,
  ) => {
    return async (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) => {
      let response: Response;
      try {
        const authResult = await requireAuthContextMock(req, options);
        response =
          authResult && typeof authResult === 'object' && 'response' in authResult
            ? authResult.response
            : await handler(req, authResult.ctx, routeContext);
      } catch (error) {
        loggerErrorMock(
          {
            event: 'route_handler_unhandled_error',
            route: req.nextUrl.pathname,
            method: req.method,
          },
          error,
        );
        response = new Response(
          JSON.stringify({
            code: 'INTERNAL_ERROR',
            message: 'サーバー内部でエラーが発生しました',
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
      }
      response.headers.set('Cache-Control', 'private, no-store, max-age=0');
      response.headers.set('Pragma', 'no-cache');
      return response;
    };
  },
}));

vi.mock('@/lib/db/rls', () => ({ withOrgContext: withOrgContextMock }));
vi.mock('@/lib/db/advisory-lock', () => ({
  acquireAdvisoryTxLock: acquireAdvisoryTxLockMock,
}));
vi.mock('@/lib/utils/logger', () => ({ logger: { error: loggerErrorMock } }));

import { DELETE, GET, PATCH } from './route';

const CURRENT_UPDATED_AT = '2026-07-17T00:00:00.000Z';
const STALE_UPDATED_AT = '2026-07-16T00:00:00.000Z';

function templateRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'template_1',
    name: '主治医報告 基本',
    template_type: 'care_report',
    target_role: 'physician',
    format: 'html',
    version: 2,
    effective_from: new Date('2026-07-01T00:00:00.000Z'),
    effective_to: new Date('2026-12-31T00:00:00.000Z'),
    content: { body_text: '固定文面' },
    is_default: true,
    created_at: new Date('2026-06-19T10:00:00.000Z'),
    updated_at: new Date(CURRENT_UPDATED_AT),
    ...overrides,
  };
}

function routeContext(id = 'template_1') {
  return { params: Promise.resolve({ id }) };
}

function createGetRequest() {
  return new NextRequest('http://localhost/api/templates/template_1', { method: 'GET' });
}

function createPatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/templates/template_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createDeleteRequest(
  query = `?expected_updated_at=${encodeURIComponent(CURRENT_UPDATED_AT)}`,
) {
  return new NextRequest(`http://localhost/api/templates/template_1${query}`, {
    method: 'DELETE',
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
    templateFindFirstMock.mockResolvedValue(templateRecord());
    templateUpdateManyMock.mockResolvedValue({ count: 1 });
    templateDeleteManyMock.mockResolvedValue({ count: 1 });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        template: {
          findFirst: templateFindFirstMock,
          updateMany: templateUpdateManyMock,
          deleteMany: templateDeleteManyMock,
        },
      }),
    );
  });

  it('returns an organization-scoped no-store template detail', async () => {
    const response = await GET(createGetRequest(), routeContext('  template_1  '));

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(templateFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'template_1', org_id: 'org_1' },
      select: expect.objectContaining({ id: true, content: true, updated_at: true }),
    });
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        requestContext: expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      }),
    );
  });

  it('returns neutral 404 for a missing or cross-organization template', async () => {
    templateFindFirstMock.mockResolvedValueOnce(null);
    const response = await GET(createGetRequest(), routeContext('template_other_org'));

    expect(response.status).toBe(404);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '文書テンプレートが見つかりません',
    });
  });

  it('rejects blank GET route ids before opening an organization context', async () => {
    const response = await GET(createGetRequest(), routeContext('   '));

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('claims the target version before clearing other defaults', async () => {
    const response = await PATCH(
      createPatchRequest({
        expected_updated_at: CURRENT_UPDATED_AT,
        name: '更新版',
        is_default: true,
      }),
      routeContext('  template_1  '),
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(templateUpdateManyMock).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'template_1',
        org_id: 'org_1',
        updated_at: new Date(CURRENT_UPDATED_AT),
      },
      data: { name: '更新版', is_default: true },
    });
    expect(templateUpdateManyMock).toHaveBeenNthCalledWith(2, {
      where: {
        org_id: 'org_1',
        template_type: 'care_report',
        is_default: true,
        id: { not: 'template_1' },
      },
      data: { is_default: false },
    });
    expect(acquireAdvisoryTxLockMock).toHaveBeenCalledWith(
      expect.anything(),
      'document_template_default',
      'org_1:care_report',
    );
    expect(acquireAdvisoryTxLockMock.mock.invocationCallOrder[0]).toBeLessThan(
      templateUpdateManyMock.mock.invocationCallOrder[0]!,
    );
  });

  it('keeps a moved default unique in the destination template type', async () => {
    const response = await PATCH(
      createPatchRequest({
        expected_updated_at: CURRENT_UPDATED_AT,
        template_type: 'important_matters',
      }),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(templateUpdateManyMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ template_type: 'important_matters' }),
      }),
    );
    expect(acquireAdvisoryTxLockMock).toHaveBeenCalledWith(
      expect.anything(),
      'document_template_default',
      'org_1:important_matters',
    );
  });

  it('clears effective dates explicitly and preserves content JSON', async () => {
    const response = await PATCH(
      createPatchRequest({
        expected_updated_at: CURRENT_UPDATED_AT,
        effective_from: null,
        effective_to: null,
        content: { blocks: ['summary', 'signature'] },
      }),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(templateUpdateManyMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          effective_from: null,
          effective_to: null,
          content: { blocks: ['summary', 'signature'] },
        }),
      }),
    );
  });

  it.each([
    ['missing version', { name: '更新版' }],
    ['invalid version', { expected_updated_at: 'yesterday', name: '更新版' }],
    ['non-object body', []],
  ])('rejects %s before opening an organization context', async (_name, body) => {
    const response = await PATCH(createPatchRequest(body), routeContext());

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects a reversed effective period without changing defaults', async () => {
    const response = await PATCH(
      createPatchRequest({
        expected_updated_at: CURRENT_UPDATED_AT,
        effective_from: '2027-01-01',
      }),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(templateUpdateManyMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      details: { effective_to: ['適用終了日は適用開始日より後にしてください'] },
    });
  });

  it('returns a typed conflict without changing defaults for a stale edit', async () => {
    const response = await PATCH(
      createPatchRequest({ expected_updated_at: STALE_UPDATED_AT, is_default: true }),
      routeContext(),
    );

    expect(response.status).toBe(409);
    expect(templateUpdateManyMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      details: {
        conflict_type: 'stale_document_template',
        expected_updated_at: STALE_UPDATED_AT,
        current_updated_at: CURRENT_UPDATED_AT,
      },
    });
  });

  it('returns a typed conflict without clearing defaults when the atomic claim loses', async () => {
    templateUpdateManyMock.mockResolvedValueOnce({ count: 0 });
    templateFindFirstMock
      .mockResolvedValueOnce(templateRecord())
      .mockResolvedValueOnce({ updated_at: new Date('2026-07-17T01:00:00.000Z') });
    const response = await PATCH(
      createPatchRequest({ expected_updated_at: CURRENT_UPDATED_AT, is_default: true }),
      routeContext(),
    );

    expect(response.status).toBe(409);
    expect(templateUpdateManyMock).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      details: { current_updated_at: '2026-07-17T01:00:00.000Z' },
    });
  });

  it('returns 404 without mutating a missing template', async () => {
    templateFindFirstMock.mockResolvedValueOnce(null);
    const response = await PATCH(
      createPatchRequest({ expected_updated_at: CURRENT_UPDATED_AT, name: '更新版' }),
      routeContext('template_missing'),
    );

    expect(response.status).toBe(404);
    expect(templateUpdateManyMock).not.toHaveBeenCalled();
  });

  it('deletes through an organization-scoped version claim', async () => {
    const response = await DELETE(createDeleteRequest(), routeContext('  template_1  '));

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(templateDeleteManyMock).toHaveBeenCalledWith({
      where: {
        id: 'template_1',
        org_id: 'org_1',
        updated_at: new Date(CURRENT_UPDATED_AT),
      },
    });
    await expect(response.json()).resolves.toEqual({ data: { id: 'template_1' } });
  });

  it.each([
    ['', 'missing'],
    ['?expected_updated_at=invalid', 'invalid'],
    [
      `?expected_updated_at=${encodeURIComponent(CURRENT_UPDATED_AT)}&expected_updated_at=${encodeURIComponent(STALE_UPDATED_AT)}`,
      'duplicate',
    ],
  ])('rejects %s DELETE version query values before DB access', async (query) => {
    const response = await DELETE(createDeleteRequest(query), routeContext());

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(templateDeleteManyMock).not.toHaveBeenCalled();
  });

  it('returns a typed conflict without deleting a stale template', async () => {
    const response = await DELETE(
      createDeleteRequest(`?expected_updated_at=${encodeURIComponent(STALE_UPDATED_AT)}`),
      routeContext(),
    );

    expect(response.status).toBe(409);
    expect(templateDeleteManyMock).not.toHaveBeenCalled();
  });

  it('detects a version race at the atomic delete claim', async () => {
    templateDeleteManyMock.mockResolvedValueOnce({ count: 0 });
    templateFindFirstMock.mockResolvedValueOnce(templateRecord()).mockResolvedValueOnce(null);
    const response = await DELETE(createDeleteRequest(), routeContext());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      details: { current_updated_at: null },
    });
  });

  it('adds no-store headers to auth failures before DB access', async () => {
    requireAuthContextMock.mockResolvedValue({
      response: new Response(JSON.stringify({ message: '権限がありません' }), { status: 403 }),
    });
    const response = await GET(createGetRequest(), routeContext());

    expect(response.status).toBe(403);
    expectNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('sanitizes and traces unexpected update failures', async () => {
    const rawMessage = 'raw patch content patient-secret';
    const error = new Error(rawMessage);
    templateUpdateManyMock.mockRejectedValueOnce(error);
    const response = await PATCH(
      createPatchRequest({ expected_updated_at: CURRENT_UPDATED_AT, name: '更新版' }),
      routeContext(),
    );

    await expectInternalError(response, rawMessage);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'route_handler_unhandled_error',
        route: '/api/templates/template_1',
        method: 'PATCH',
      }),
      error,
    );
  });
});
