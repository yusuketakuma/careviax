import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
    formularyChangeRequest: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    drugMaster: { findFirst: vi.fn() },
    pharmacyDrugStock: { upsert: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth/config', () => ({ auth: authMock }));
vi.mock('@/lib/db/client', () => ({ prisma: prismaMock }));

import { PATCH } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/pharmacy-drug-stock-requests/request_1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/pharmacy-drug-stock-requests/request_1', {
    method: 'PATCH',
    body: '{"decision":',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

describe('/api/pharmacy-drug-stock-requests/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.formularyChangeRequest.findFirst.mockResolvedValue({
      id: 'request_1',
      org_id: 'org_1',
      site_id: 'site_1',
      drug_master_id: 'drug_1',
      status: 'pending',
      requested_payload: {
        is_stocked: true,
        reorder_point: 10,
        preferred_generic_id: null,
        adoption_note: '山田花子 090-1234-5678 承認反映',
      },
    });
    prismaMock.$transaction.mockImplementation((callback) =>
      callback({
        formularyChangeRequest: prismaMock.formularyChangeRequest,
        pharmacyDrugStock: prismaMock.pharmacyDrugStock,
        auditLog: prismaMock.auditLog,
      }),
    );
    prismaMock.pharmacyDrugStock.upsert.mockResolvedValue({ id: 'stock_1' });
    prismaMock.formularyChangeRequest.update.mockResolvedValue({
      id: 'request_1',
      status: 'approved',
    });
    prismaMock.formularyChangeRequest.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit_1' });
  });

  it('approves a pending request and applies it to stock', async () => {
    const response = await PATCH(
      createRequest({ decision: 'approve', decision_note: '患者A 090-1234-5678 承認' }),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      request: { id: 'request_1', status: 'approved' },
      stock: { id: 'stock_1' },
    });
    expect(prismaMock.pharmacyDrugStock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          org_id: 'org_1',
          site_id: 'site_1',
          drug_master_id: 'drug_1',
          is_stocked: true,
          adoption_source: 'approval',
          adoption_note: '山田花子 090-1234-5678 承認反映',
        }),
        update: expect.objectContaining({
          is_stocked: true,
          reorder_point: 10,
          adoption_source: 'approval',
          adoption_note: '山田花子 090-1234-5678 承認反映',
        }),
      }),
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'pharmacy_drug_stock_change_approved',
          target_type: 'FormularyChangeRequest',
          target_id: 'request_1',
        }),
      }),
    );
    const auditChanges = prismaMock.auditLog.create.mock.calls[0]?.[0]?.data?.changes;
    const auditChangesText = JSON.stringify(auditChanges);
    expect(auditChanges).toMatchObject({
      request_id: 'request_1',
      site_id: 'site_1',
      drug_master_id: 'drug_1',
      requested_payload: {
        is_stocked: true,
        reorder_point: 10,
        preferred_generic_id: null,
        adoption_note_present: true,
        adoption_note_length: expect.any(Number),
        adoption_note_redacted: true,
      },
      decision_note_present: true,
      decision_note_length: expect.any(Number),
      decision_note_redacted: true,
      applied_stock_id: 'stock_1',
    });
    expect(auditChanges).not.toHaveProperty('decision_note');
    expect(auditChanges.requested_payload).not.toHaveProperty('adoption_note');
    expect(auditChangesText).not.toContain('患者A');
    expect(auditChangesText).not.toContain('山田花子');
    expect(auditChangesText).not.toContain('090-1234-5678');
    // 楽観的 claim は status='pending' を条件に含めて確定する
    expect(prismaMock.formularyChangeRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'request_1', org_id: 'org_1', status: 'pending' },
        data: expect.objectContaining({ status: 'approved', decided_by_id: 'user_1' }),
      }),
    );
    expect(prismaMock.formularyChangeRequest.update).not.toHaveBeenCalled();
  });

  it('rejects a pending request without mutating stock', async () => {
    prismaMock.formularyChangeRequest.update.mockResolvedValue({
      id: 'request_1',
      status: 'rejected',
    });

    const response = await PATCH(
      createRequest({ decision: 'reject', decision_note: '今回は見送り' }),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      request: { id: 'request_1', status: 'rejected' },
      stock: null,
    });
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'pharmacy_drug_stock_change_rejected',
        }),
      }),
    );
    const auditChanges = prismaMock.auditLog.create.mock.calls[0]?.[0]?.data?.changes;
    const auditChangesText = JSON.stringify(auditChanges);
    expect(auditChanges).toMatchObject({
      request_id: 'request_1',
      site_id: 'site_1',
      drug_master_id: 'drug_1',
      requested_payload: {
        is_stocked: true,
        reorder_point: 10,
        preferred_generic_id: null,
        adoption_note_present: true,
        adoption_note_length: expect.any(Number),
        adoption_note_redacted: true,
      },
      decision_note_present: true,
      decision_note_length: expect.any(Number),
      decision_note_redacted: true,
      applied_stock_id: null,
    });
    expect(auditChanges).not.toHaveProperty('decision_note');
    expect(auditChanges.requested_payload).not.toHaveProperty('adoption_note');
    expect(auditChangesText).not.toContain('今回は見送り');
    expect(auditChangesText).not.toContain('山田花子');
    expect(auditChangesText).not.toContain('090-1234-5678');
  });

  it('rejects non-object request bodies before looking up the request', async () => {
    const response = await PATCH(createRequest(['approve']), {
      params: Promise.resolve({ id: 'request_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(prismaMock.formularyChangeRequest.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.formularyChangeRequest.update).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before looking up the request', async () => {
    const response = await PATCH(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'request_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(prismaMock.formularyChangeRequest.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.formularyChangeRequest.update).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects malformed persisted requested payloads before approval mutation', async () => {
    prismaMock.formularyChangeRequest.findFirst.mockResolvedValue({
      id: 'request_1',
      org_id: 'org_1',
      site_id: 'site_1',
      drug_master_id: 'drug_1',
      status: 'pending',
      requested_payload: ['unexpected'],
    });

    const response = await PATCH(createRequest({ decision: 'approve' }), {
      params: Promise.resolve({ id: 'request_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '申請内容が破損しているため承認できません',
      details: { request_id: 'request_1' },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.formularyChangeRequest.update).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects blank persisted preferred generic ids before approval mutation', async () => {
    prismaMock.formularyChangeRequest.findFirst.mockResolvedValue({
      id: 'request_1',
      org_id: 'org_1',
      site_id: 'site_1',
      drug_master_id: 'drug_1',
      status: 'pending',
      requested_payload: {
        is_stocked: true,
        reorder_point: 10,
        preferred_generic_id: '   ',
        adoption_note: '承認反映',
      },
    });

    const response = await PATCH(createRequest({ decision: 'approve' }), {
      params: Promise.resolve({ id: 'request_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '申請内容が破損しているため承認できません',
      details: { request_id: 'request_1' },
    });
    expect(prismaMock.drugMaster.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.formularyChangeRequest.update).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects missing persisted preferred generic ids before approval mutation', async () => {
    prismaMock.formularyChangeRequest.findFirst.mockResolvedValue({
      id: 'request_1',
      org_id: 'org_1',
      site_id: 'site_1',
      drug_master_id: 'drug_1',
      status: 'pending',
      requested_payload: {
        is_stocked: true,
        reorder_point: 10,
        preferred_generic_id: 'generic_missing',
        adoption_note: '承認反映',
      },
    });
    prismaMock.drugMaster.findFirst
      .mockResolvedValueOnce({ id: 'drug_1', generic_name: 'アムロジピン' })
      .mockResolvedValueOnce(null);

    const response = await PATCH(createRequest({ decision: 'approve' }), {
      params: Promise.resolve({ id: 'request_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '申請内容が破損しているため承認できません',
      details: {
        request_id: 'request_1',
        invalid_field: 'preferred_generic_id',
      },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.formularyChangeRequest.update).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects already processed requests before mutation', async () => {
    prismaMock.formularyChangeRequest.findFirst.mockResolvedValue({
      id: 'request_1',
      status: 'approved',
    });

    const response = await PATCH(createRequest({ decision: 'approve' }), {
      params: Promise.resolve({ id: 'request_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.formularyChangeRequest.update).not.toHaveBeenCalled();
  });

  it('returns a workflow conflict without side effects when a concurrent decision wins the claim', async () => {
    // findFirst は pending を返して事前チェックを通過するが、
    // トランザクション内の楽観的 claim が count=0（同時 approve に先を越された）となる。
    prismaMock.formularyChangeRequest.updateMany.mockResolvedValue({ count: 0 });

    const response = await PATCH(createRequest({ decision: 'approve' }), {
      params: Promise.resolve({ id: 'request_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'この申請はすでに処理済みです',
    });
    // 二重承認の副作用（stock 反映・監査ログ）は発火しない
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});
