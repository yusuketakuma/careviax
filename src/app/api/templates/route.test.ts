import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  withOrgContextMock,
  templateFindManyMock,
  templateCountMock,
  templateCreateMock,
  templateUpdateManyMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  templateFindManyMock: vi.fn(),
  templateCountMock: vi.fn(),
  templateCreateMock: vi.fn(),
  templateUpdateManyMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (
      handler: (
        req: NextRequest,
        ctx: { orgId: string; userId: string; role: string },
        routeContext: { params: Promise<Record<string, string>> },
      ) => Promise<Response>,
    ) =>
    (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' }, routeContext),
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    template: {
      findMany: templateFindManyMock,
    },
  },
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));
import { GET, POST } from './route';

function createRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function createMalformedJsonPostRequest() {
  return new NextRequest('http://localhost/api/templates', {
    method: 'POST',
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

describe('/api/templates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    templateFindManyMock.mockResolvedValue([]);
    templateCountMock.mockResolvedValue(0);
    templateCreateMock.mockResolvedValue({ id: 'template_1', name: '主治医報告 基本' });
    templateUpdateManyMock.mockResolvedValue({ count: 1 });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        template: {
          findMany: templateFindManyMock,
          count: templateCountMock,
          create: templateCreateMock,
          updateMany: templateUpdateManyMock,
        },
      }),
    );
  });

  it('lists templates filtered by org and template_type', async () => {
    templateFindManyMock.mockResolvedValue([{ id: 'template_1' }]);
    templateCountMock.mockResolvedValue(3);

    const response = await GET(
      createRequest('http://localhost/api/templates?template_type=care_report'),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(templateFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          template_type: 'care_report',
        }),
        take: 100,
      }),
    );
    expect(templateCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        template_type: 'care_report',
      },
    });
    const body = await response.json();
    expect(Object.keys(body)).toEqual([
      'data',
      'total_count',
      'visible_count',
      'hidden_count',
      'truncated',
      'count_basis',
      'filters_applied',
      'limit',
    ]);
    expect(body).toMatchObject({
      data: [{ id: 'template_1' }],
      total_count: 3,
      visible_count: 1,
      hidden_count: 2,
      truncated: true,
      count_basis: 'templates',
      filters_applied: {
        template_type: 'care_report',
        target_role: null,
      },
      limit: 100,
    });
  });

  it('trims template_type query filters before listing templates', async () => {
    const response = await GET(
      createRequest('http://localhost/api/templates?template_type=%20care_report%20'),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(templateFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          template_type: 'care_report',
        }),
      }),
    );
  });

  it('bounds template list size and trims target_role query filters', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/templates?template_type=contract_document&target_role=%20patient_family%20&limit=5',
      ),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(templateFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          template_type: 'contract_document',
          target_role: 'patient_family',
        }),
        take: 5,
      }),
    );
    expect(templateCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        template_type: 'contract_document',
        target_role: 'patient_family',
      },
    });
  });

  it('clamps overly large template list limits', async () => {
    const response = await GET(createRequest('http://localhost/api/templates?limit=9999'), {
      params: Promise.resolve({}),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(templateFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 200,
      }),
    );
  });

  it('creates a template and clears the previous default when requested', async () => {
    const response = await POST(
      createRequest('http://localhost/api/templates', {
        name: '主治医報告 基本',
        template_type: 'care_report',
        content: { sections: ['summary'] },
        is_default: true,
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(templateUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          template_type: 'care_report',
          is_default: true,
        }),
      }),
    );
    expect(templateCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org_id: 'org_1',
          name: '主治医報告 基本',
          template_type: 'care_report',
          content: { sections: ['summary'] },
          format: 'html',
          version: 1,
          is_default: true,
        }),
      }),
    );
  });

  it('creates a consent template with version metadata', async () => {
    const response = await POST(
      createRequest('http://localhost/api/templates', {
        name: '同意書 v2',
        template_type: 'consent_form',
        target_role: 'patient_family',
        format: 'pdf',
        version: 2,
        effective_from: '2026-04-01',
        content: { blocks: ['signature'] },
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(templateCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          template_type: 'consent_form',
          target_role: 'patient_family',
          format: 'pdf',
          version: 2,
          effective_from: new Date('2026-04-01T00:00:00.000Z'),
        }),
      }),
    );
  });

  it('creates a contract document template with version metadata', async () => {
    const response = await POST(
      createRequest('http://localhost/api/templates', {
        name: '居宅療養管理指導契約書 2026年版',
        template_type: 'contract_document',
        target_role: 'patient_family',
        format: 'html',
        version: 1,
        effective_from: '2026-04-01',
        content: { sections: ['patient', 'service_start', 'signature'] },
        is_default: true,
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(templateUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          template_type: 'contract_document',
          is_default: true,
        }),
      }),
    );
    expect(templateCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: '居宅療養管理指導契約書 2026年版',
          template_type: 'contract_document',
          target_role: 'patient_family',
          version: 1,
          effective_from: new Date('2026-04-01T00:00:00.000Z'),
          content: { sections: ['patient', 'service_start', 'signature'] },
        }),
      }),
    );
  });

  it('rejects non-object create payloads before opening an org transaction', async () => {
    const response = await POST(createRequest('http://localhost/api/templates', []), {
      params: Promise.resolve({}),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(templateUpdateManyMock).not.toHaveBeenCalled();
    expect(templateCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before opening an org transaction', async () => {
    const response = await POST(createMalformedJsonPostRequest(), {
      params: Promise.resolve({}),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(templateUpdateManyMock).not.toHaveBeenCalled();
    expect(templateCreateMock).not.toHaveBeenCalled();
  });

  it('returns validation error for unsupported template_type query', async () => {
    const response = await GET(
      createRequest('http://localhost/api/templates?template_type=unknown'),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(templateFindManyMock).not.toHaveBeenCalled();
    expect(templateCountMock).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', 'http://localhost/api/templates?template_type='],
    ['blank', 'http://localhost/api/templates?template_type=%20%20'],
  ])('returns validation error for %s template_type query', async (_label, url) => {
    const response = await GET(createRequest(url), { params: Promise.resolve({}) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        template_type: ['template_type が不正です'],
      },
    });
    expect(templateFindManyMock).not.toHaveBeenCalled();
    expect(templateCountMock).not.toHaveBeenCalled();
  });

  it('returns validation error for blank target_role query', async () => {
    const response = await GET(createRequest('http://localhost/api/templates?target_role=%20%20'), {
      params: Promise.resolve({}),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(templateFindManyMock).not.toHaveBeenCalled();
    expect(templateCountMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when template listing fails unexpectedly', async () => {
    const rawMessage = 'raw template content 患者A';
    templateFindManyMock.mockRejectedValue(new Error(rawMessage));

    const response = await GET(createRequest('http://localhost/api/templates'), {
      params: Promise.resolve({}),
    });

    if (!response) throw new Error('response is required');
    await expectInternalError(response, rawMessage);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'templates_get_unhandled_error',
        route: '/api/templates',
        method: 'GET',
        status: 500,
      }),
      expect.any(Error),
    );
  });

  it('returns a sanitized no-store 500 when template creation fails unexpectedly', async () => {
    const rawMessage = 'raw create body 患者B';
    templateCreateMock.mockRejectedValue(new Error(rawMessage));

    const response = await POST(
      createRequest('http://localhost/api/templates', {
        name: '主治医報告 基本',
        template_type: 'care_report',
        content: { body_text: rawMessage },
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    await expectInternalError(response, rawMessage);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'templates_post_unhandled_error',
        route: '/api/templates',
        method: 'POST',
        status: 500,
      }),
      expect.any(Error),
    );
  });
});
