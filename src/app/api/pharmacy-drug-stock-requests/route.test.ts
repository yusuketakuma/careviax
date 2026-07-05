import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const { authMock, loggerErrorMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
    pharmacySite: { findFirst: vi.fn() },
    drugMaster: { findFirst: vi.fn() },
    pharmacyDrugStock: { findFirst: vi.fn() },
    formularyChangeRequest: {
      count: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
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
  return new NextRequest('http://localhost/api/pharmacy-drug-stock-requests', {
    method: 'POST',
    body: '{"site_id":',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

describe('/api/pharmacy-drug-stock-requests', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.pharmacySite.findFirst.mockResolvedValue({ id: 'site_1', name: '本店' });
    prismaMock.drugMaster.findFirst.mockResolvedValue({
      id: 'drug_1',
      drug_name: 'ノルバスク錠5mg',
      generic_name: 'アムロジピン',
    });
    prismaMock.pharmacyDrugStock.findFirst.mockResolvedValue({
      id: 'stock_1',
      is_stocked: false,
      reorder_point: null,
      preferred_generic_id: null,
      adoption_note: null,
    });
    prismaMock.$transaction.mockImplementation((callback) =>
      callback({
        formularyChangeRequest: prismaMock.formularyChangeRequest,
        auditLog: prismaMock.auditLog,
      }),
    );
    prismaMock.formularyChangeRequest.create.mockResolvedValue({
      id: 'request_1',
      status: 'pending',
    });
    prismaMock.formularyChangeRequest.count.mockResolvedValue(0);
    prismaMock.formularyChangeRequest.findFirst.mockResolvedValue(null);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit_1' });
  });

  it('creates a pending formulary change request without mutating stock', async () => {
    prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce({
      id: 'stock_1',
      is_stocked: false,
      reorder_point: null,
      preferred_generic_id: null,
      adoption_note: '旧メモ 山田太郎 090-0000-1111',
    });

    const response = await POST(
      createRequest('http://localhost/api/pharmacy-drug-stock-requests', {
        site_id: 'site_1',
        drug_master_id: 'drug_1',
        action_type: 'adopt',
        requested_payload: {
          is_stocked: true,
          reorder_point: 10,
          preferred_generic_id: null,
          adoption_note: '山田花子 090-1234-5678 委員会承認待ち',
        },
        reason: '患者A 090-1234-5678 の新規採用候補',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 'request_1', status: 'pending' },
    });
    expect(prismaMock.formularyChangeRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org_id: 'org_1',
          site_id: 'site_1',
          drug_master_id: 'drug_1',
          requested_by_id: 'user_1',
          action_type: 'adopt',
          requested_payload: expect.objectContaining({ is_stocked: true, reorder_point: 10 }),
          current_snapshot: expect.objectContaining({ id: 'stock_1' }),
          reason: '患者A 090-1234-5678 の新規採用候補',
        }),
      }),
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'pharmacy_drug_stock_change_requested',
          target_type: 'FormularyChangeRequest',
        }),
      }),
    );
    const auditChanges = prismaMock.auditLog.create.mock.calls[0]?.[0]?.data?.changes;
    const auditChangesText = JSON.stringify(auditChanges);
    expect(auditChanges).toMatchObject({
      site_id: 'site_1',
      drug_master_id: 'drug_1',
      action_type: 'adopt',
      reason_present: true,
      reason_length: expect.any(Number),
      reason_redacted: true,
      requested_payload: {
        is_stocked: true,
        reorder_point: 10,
        preferred_generic_id: null,
        adoption_note_present: true,
        adoption_note_length: expect.any(Number),
        adoption_note_redacted: true,
      },
      current_snapshot: {
        id: 'stock_1',
        is_stocked: false,
        reorder_point: null,
        preferred_generic_id: null,
        adoption_note_present: true,
        adoption_note_length: expect.any(Number),
        adoption_note_redacted: true,
      },
    });
    expect(auditChanges).not.toHaveProperty('reason');
    expect(auditChanges.requested_payload).not.toHaveProperty('adoption_note');
    expect(auditChanges.current_snapshot).not.toHaveProperty('adoption_note');
    expect(auditChangesText).not.toContain('患者A');
    expect(auditChangesText).not.toContain('山田花子');
    expect(auditChangesText).not.toContain('山田太郎');
    expect(auditChangesText).not.toContain('090-1234-5678');
    expect(auditChangesText).not.toContain('090-0000-1111');
  });

  it('rejects duplicate pending requests for the same site and drug', async () => {
    prismaMock.formularyChangeRequest.findFirst.mockResolvedValue({
      id: 'request_existing',
      created_at: new Date('2026-05-27T00:00:00.000Z'),
    });

    const response = await POST(
      createRequest('http://localhost/api/pharmacy-drug-stock-requests', {
        site_id: 'site_1',
        drug_master_id: 'drug_1',
        action_type: 'adopt',
        requested_payload: {
          is_stocked: true,
          reorder_point: 10,
          preferred_generic_id: null,
          adoption_note: '委員会承認待ち',
        },
        reason: '新規採用候補',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        request_id: 'request_existing',
        created_at: '2026-05-27T00:00:00.000Z',
      },
    });
    expect(prismaMock.formularyChangeRequest.create).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects non-object request bodies before lookup or mutation', async () => {
    const response = await POST(
      createRequest('http://localhost/api/pharmacy-drug-stock-requests', ['unexpected']),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.drugMaster.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.formularyChangeRequest.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.formularyChangeRequest.create).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before lookup or mutation', async () => {
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
    expect(prismaMock.drugMaster.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.formularyChangeRequest.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.formularyChangeRequest.create).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects blank preferred generic ids before lookup or mutation', async () => {
    const response = await POST(
      createRequest('http://localhost/api/pharmacy-drug-stock-requests', {
        site_id: 'site_1',
        drug_master_id: 'drug_1',
        requested_payload: {
          is_stocked: true,
          reorder_point: 10,
          preferred_generic_id: '   ',
          adoption_note: '委員会承認待ち',
        },
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
    });
    expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.drugMaster.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.formularyChangeRequest.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.formularyChangeRequest.create).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects missing preferred generic ids before request creation', async () => {
    prismaMock.drugMaster.findFirst
      .mockResolvedValueOnce({
        id: 'drug_1',
        drug_name: 'ノルバスク錠5mg',
        generic_name: 'アムロジピン',
      })
      .mockResolvedValueOnce(null);

    const response = await POST(
      createRequest('http://localhost/api/pharmacy-drug-stock-requests', {
        site_id: 'site_1',
        drug_master_id: 'drug_1',
        requested_payload: {
          is_stocked: true,
          reorder_point: 10,
          preferred_generic_id: 'generic_missing',
          adoption_note: '委員会承認待ち',
        },
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '採用後発薬が見つかりません',
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.formularyChangeRequest.create).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('marks missing-site POST responses as no-store before request creation', async () => {
    prismaMock.pharmacySite.findFirst.mockResolvedValue(null);

    const response = await POST(
      createRequest('http://localhost/api/pharmacy-drug-stock-requests', {
        site_id: 'site_missing',
        drug_master_id: 'drug_1',
        requested_payload: {
          is_stocked: true,
          reorder_point: 10,
          preferred_generic_id: null,
          adoption_note: '委員会承認待ち',
        },
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
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.formularyChangeRequest.create).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('marks unauthenticated POST responses as no-store before handler execution', async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(
      createRequest('http://localhost/api/pharmacy-drug-stock-requests', {
        site_id: 'site_1',
        drug_master_id: 'drug_1',
        requested_payload: {
          is_stocked: true,
          reorder_point: 10,
          preferred_generic_id: null,
          adoption_note: '委員会承認待ち',
        },
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
      createRequest('http://localhost/api/pharmacy-drug-stock-requests', {
        site_id: 'site_1',
        drug_master_id: 'drug_1',
        requested_payload: {
          is_stocked: true,
          reorder_point: 10,
          preferred_generic_id: null,
          adoption_note: '委員会承認待ち',
        },
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
    const rawMessage = 'raw request mutation patient secret';
    prismaMock.pharmacySite.findFirst.mockRejectedValueOnce(new Error(rawMessage));

    const response = await POST(
      createRequest('http://localhost/api/pharmacy-drug-stock-requests', {
        site_id: 'site_1',
        drug_master_id: 'drug_1',
        requested_payload: {
          is_stocked: true,
          reorder_point: 10,
          preferred_generic_id: null,
          adoption_note: '委員会承認待ち',
        },
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
        route: '/api/pharmacy-drug-stock-requests',
        method: 'POST',
      }),
      expect.any(Error),
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls[0]?.[0])).not.toContain(rawMessage);
  });

  it('lists pending requests scoped by site after validating same org site', async () => {
    prismaMock.formularyChangeRequest.findMany.mockResolvedValue([
      { id: 'request_1', status: 'pending' },
    ]);
    prismaMock.formularyChangeRequest.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    prismaMock.formularyChangeRequest.findFirst.mockResolvedValue({
      created_at: new Date('2026-05-10T00:00:00.000Z'),
    });

    const response = await GET(
      createRequest(
        'http://localhost/api/pharmacy-drug-stock-requests?site_id=site_1&overdue_days=%207%20&limit=%2010%20',
      ),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'request_1', status: 'pending' }],
      summary: {
        status: 'pending',
        total_count: 3,
        overdue_count: 1,
        overdue_days: 7,
        oldest_pending_created_at: '2026-05-10T00:00:00.000Z',
        notification_level: 'overdue',
      },
    });
    expect(prismaMock.formularyChangeRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ org_id: 'org_1', site_id: 'site_1', status: 'pending' }),
        take: 10,
      }),
    );
    expect(prismaMock.formularyChangeRequest.count).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          site_id: 'site_1',
          status: 'pending',
          created_at: expect.objectContaining({ lt: expect.any(Date) }),
        }),
      }),
    );
  });

  it('rejects malformed numeric query values before scoped reads', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/pharmacy-drug-stock-requests?site_id=site_1&overdue_days=1e1&limit=10.0',
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
    expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.formularyChangeRequest.findMany).not.toHaveBeenCalled();
    expect(prismaMock.formularyChangeRequest.count).not.toHaveBeenCalled();
    expect(prismaMock.formularyChangeRequest.findFirst).not.toHaveBeenCalled();
  });

  it('marks missing-site GET responses as no-store before request reads', async () => {
    prismaMock.pharmacySite.findFirst.mockResolvedValue(null);

    const response = await GET(
      createRequest('http://localhost/api/pharmacy-drug-stock-requests?site_id=site_other'),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
      message: '対象の薬局拠点が見つかりません',
    });
    expect(prismaMock.formularyChangeRequest.findMany).not.toHaveBeenCalled();
    expect(prismaMock.formularyChangeRequest.count).not.toHaveBeenCalled();
    expect(prismaMock.formularyChangeRequest.findFirst).not.toHaveBeenCalled();
  });

  it('marks unauthenticated GET responses as no-store before handler execution', async () => {
    authMock.mockResolvedValue(null);

    const response = await GET(
      createRequest('http://localhost/api/pharmacy-drug-stock-requests?site_id=site_1'),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(401);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_UNAUTHENTICATED',
    });
    expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.formularyChangeRequest.findMany).not.toHaveBeenCalled();
  });

  it('marks sanitized unexpected GET errors as no-store', async () => {
    const rawMessage = 'raw request patient secret';
    prismaMock.pharmacySite.findFirst.mockRejectedValueOnce(new Error(rawMessage));

    const response = await GET(
      createRequest('http://localhost/api/pharmacy-drug-stock-requests?site_id=site_1'),
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
        route: '/api/pharmacy-drug-stock-requests',
        method: 'GET',
      }),
      expect.any(Error),
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls[0]?.[0])).not.toContain(rawMessage);
  });
});
