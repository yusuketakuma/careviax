import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const { authMock, loggerErrorMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
    pharmacySite: { findFirst: vi.fn() },
    pharmacyDrugStock: { findMany: vi.fn() },
    formularyTemplate: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth/config', () => ({ auth: authMock }));
vi.mock('@/lib/db/client', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: loggerErrorMock,
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { GET, POST } from './route';

function createRequest(url: string, body?: unknown) {
  if (body === undefined) {
    return new NextRequest(url, {
      headers: { 'x-org-id': 'org_1' },
    });
  }
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

function createMalformedJsonPostRequest() {
  return new NextRequest('http://localhost/api/pharmacy-drug-stock-templates', {
    method: 'POST',
    body: '{"name":',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

describe('/api/pharmacy-drug-stock-templates', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.pharmacySite.findFirst.mockResolvedValue({ id: 'site_1', name: '本店' });
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([
      {
        drug_master_id: 'drug_1',
        reorder_point: 10,
        preferred_generic_id: null,
        adoption_note: '標準採用',
      },
    ]);
    prismaMock.$transaction.mockImplementation((callback) =>
      callback({
        formularyTemplate: prismaMock.formularyTemplate,
        auditLog: prismaMock.auditLog,
      }),
    );
    prismaMock.formularyTemplate.create.mockResolvedValue({
      id: 'template_1',
      name: '在宅内科 標準セット',
      item_count: 1,
    });
    prismaMock.formularyTemplate.findFirst.mockResolvedValue(null);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit_1' });
  });

  it('lists formulary templates for the current org with optional search and limit', async () => {
    prismaMock.formularyTemplate.findMany.mockResolvedValue([
      { id: 'template_1', name: '在宅内科 標準セット', item_count: 12 },
    ]);

    const response = await GET(
      createRequest(
        'http://localhost/api/pharmacy-drug-stock-templates?q=%E5%9C%A8%E5%AE%85&limit=%2010%20',
      ),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'template_1', item_count: 12 }],
    });
    expect(prismaMock.formularyTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          OR: [{ name: { contains: '在宅' } }, { description: { contains: '在宅' } }],
        },
        take: 10,
      }),
    );
  });

  it('rejects malformed numeric query values before listing templates', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/pharmacy-drug-stock-templates?q=%E5%9C%A8%E5%AE%85&limit=1e2',
      ),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'クエリパラメータが不正です',
    });
    expect(prismaMock.formularyTemplate.findMany).not.toHaveBeenCalled();
  });

  it('marks unauthenticated GET responses as no-store before handler execution', async () => {
    authMock.mockResolvedValue(null);

    const response = await GET(
      createRequest('http://localhost/api/pharmacy-drug-stock-templates'),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(401);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_UNAUTHENTICATED',
    });
    expect(prismaMock.formularyTemplate.findMany).not.toHaveBeenCalled();
  });

  it('marks sanitized unexpected GET errors as no-store', async () => {
    const rawMessage = 'raw template patient secret';
    prismaMock.formularyTemplate.findMany.mockRejectedValueOnce(new Error(rawMessage));

    const response = await GET(
      createRequest('http://localhost/api/pharmacy-drug-stock-templates'),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawMessage);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'route_handler_unhandled_error',
        route: '/api/pharmacy-drug-stock-templates',
        method: 'GET',
      }),
      expect.any(Error),
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls[0]?.[0])).not.toContain(rawMessage);
  });

  it('creates a template from stocked drugs at a same-org site', async () => {
    const response = await POST(
      createRequest('http://localhost/api/pharmacy-drug-stock-templates', {
        name: '在宅内科 標準セット',
        source_site_id: 'site_1',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 'template_1', item_count: 1 },
    });
    expect(prismaMock.formularyTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org_id: 'org_1',
          name: '在宅内科 標準セット',
          source_site_id: 'site_1',
          created_by_id: 'user_1',
          item_count: 1,
          items: [
            {
              drug_master_id: 'drug_1',
              reorder_point: 10,
              preferred_generic_id: null,
              adoption_note: '標準採用',
            },
          ],
        }),
      }),
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'formulary_template_created',
          target_type: 'FormularyTemplate',
          changes: {
            source_site_id: 'site_1',
            item_count: 1,
          },
        }),
      }),
    );
  });

  it('rejects non-object request bodies before reading the source site', async () => {
    const response = await POST(
      createRequest('http://localhost/api/pharmacy-drug-stock-templates', ['unexpected']),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.formularyTemplate.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.formularyTemplate.create).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before reading the source site', async () => {
    const response = await POST(createMalformedJsonPostRequest(), {
      params: Promise.resolve({}),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.formularyTemplate.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.formularyTemplate.create).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate template names in the same org before reading source stocks', async () => {
    prismaMock.formularyTemplate.findFirst.mockResolvedValue({
      id: 'template_existing',
      name: '在宅内科 標準セット',
    });

    const response = await POST(
      createRequest('http://localhost/api/pharmacy-drug-stock-templates', {
        name: '在宅内科 標準セット',
        source_site_id: 'site_1',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同じ名前の採用品テンプレートがすでに存在します',
      details: {
        template_id: 'template_existing',
        name: '在宅内科 標準セット',
      },
    });
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
    expect(prismaMock.formularyTemplate.create).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('marks missing-site POST responses as no-store before reading source stocks', async () => {
    prismaMock.pharmacySite.findFirst.mockResolvedValue(null);

    const response = await POST(
      createRequest('http://localhost/api/pharmacy-drug-stock-templates', {
        name: '在宅内科 標準セット',
        source_site_id: 'site_missing',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
      message: '対象の薬局拠点が見つかりません',
    });
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
    expect(prismaMock.formularyTemplate.create).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('marks empty-source-stock conflicts as no-store before template creation', async () => {
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);

    const response = await POST(
      createRequest('http://localhost/api/pharmacy-drug-stock-templates', {
        name: '在宅内科 標準セット',
        source_site_id: 'site_1',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'テンプレート化する採用品がありません',
      details: { source_site_id: 'site_1' },
    });
    expect(prismaMock.formularyTemplate.create).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('marks unauthenticated POST responses as no-store before handler execution', async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(
      createRequest('http://localhost/api/pharmacy-drug-stock-templates', {
        name: '在宅内科 標準セット',
        source_site_id: 'site_1',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(401);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_UNAUTHENTICATED',
    });
    expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('marks forbidden POST responses as no-store before handler execution', async () => {
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'clerk' });

    const response = await POST(
      createRequest('http://localhost/api/pharmacy-drug-stock-templates', {
        name: '在宅内科 標準セット',
        source_site_id: 'site_1',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
    expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('marks sanitized unexpected POST errors as no-store', async () => {
    const rawMessage = 'raw template mutation patient secret';
    prismaMock.pharmacySite.findFirst.mockRejectedValueOnce(new Error(rawMessage));

    const response = await POST(
      createRequest('http://localhost/api/pharmacy-drug-stock-templates', {
        name: '在宅内科 標準セット',
        source_site_id: 'site_1',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawMessage);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'route_handler_unhandled_error',
        route: '/api/pharmacy-drug-stock-templates',
        method: 'POST',
      }),
      expect.any(Error),
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls[0]?.[0])).not.toContain(rawMessage);
  });
});
