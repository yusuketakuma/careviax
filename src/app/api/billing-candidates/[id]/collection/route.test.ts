import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  findFirstMock,
  updateManyMock,
  findUniqueMock,
  taskFindFirstMock,
  auditLogCreateMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  findFirstMock: vi.fn(),
  updateManyMock: vi.fn(),
  findUniqueMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { PATCH } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/billing-candidates/candidate_1/collection', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: JSON.stringify(body),
  });
}

describe('/api/billing-candidates/[id]/collection PATCH', () => {
  const updatedAt = new Date('2026-06-01T00:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      },
    });
    findFirstMock.mockResolvedValue({
      id: 'candidate_1',
      patient_id: 'patient_1',
      billing_target_type: 'patient',
      billing_target_id: 'patient_1',
      status: 'confirmed',
      calculation_breakdown: { amount_yen: 3240 },
      updated_at: updatedAt,
    });
    updateManyMock.mockResolvedValue({ count: 1 });
    findUniqueMock.mockResolvedValue({
      id: 'candidate_1',
      calculation_breakdown: {
        amount_yen: 3240,
        collection: {
          status: 'partial',
          billed_amount: 3240,
          collected_amount: 2160,
          unpaid_amount: 1080,
        },
      },
    });
    taskFindFirstMock.mockResolvedValue({
      metadata: {
        receipt_issue: 'paper',
      },
    });
    auditLogCreateMock.mockResolvedValue({});
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        billingCandidate: {
          findFirst: findFirstMock,
          updateMany: updateManyMock,
          findUnique: findUniqueMock,
        },
        task: {
          findFirst: taskFindFirstMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('records collection metadata in calculation_breakdown and writes an audit log', async () => {
    const response = await PATCH(
      createRequest({
        status: 'partial',
        billed_amount: 3240,
        collected_amount: 2160,
        payment_method: 'cash',
        payer_name: '長女',
        billed_at: '2026-06-15T00:00:00.000Z',
        scheduled_collection_at: '2026-06-25T00:00:00.000Z',
        collected_at: '2026-06-16T00:00:00.000Z',
        receipt_number: 'R20260616-001',
        receipt_issue_status: 'issued',
        invoice_issue_status: 'issued',
        save_receipt_copy: true,
        unpaid_reason: '次回訪問時に残額集金',
      }),
      { params: Promise.resolve({ id: ' candidate_1 ' }) },
    );

    expect(response.status).toBe(200);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(Object), {
      permission: 'canManageBilling',
      message: '集金記録の更新権限がありません',
    });
    expect(updateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'candidate_1',
        org_id: 'org_1',
        updated_at: updatedAt,
      },
      data: {
        calculation_breakdown: expect.objectContaining({
          amount_yen: 3240,
          collection: expect.objectContaining({
            status: 'partial',
            billed_amount: 3240,
            collected_amount: 2160,
            unpaid_amount: 1080,
            payment_method: 'cash',
            payer_name: '長女',
            scheduled_collection_at: '2026-06-25T00:00:00.000Z',
            receipt_number: 'R20260616-001',
            receipt_issue_status: 'issued',
            invoice_issue_status: 'issued',
            save_receipt_copy: true,
            receipt_copy_url: '/api/billing-candidates/candidate_1/documents/pdf?kind=receipt',
            invoice_copy_url: '/api/billing-candidates/candidate_1/documents/pdf?kind=invoice',
            updated_by: 'user_1',
          }),
        }),
      },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org_id: 'org_1',
          actor_id: 'user_1',
          action: 'billing_collection_updated',
          target_type: 'BillingCandidate',
          target_id: 'candidate_1',
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 'candidate_1' },
    });
  });

  it('rejects collected payments without receipt numbers when receipt issuance is required', async () => {
    const response = await PATCH(
      createRequest({
        status: 'collected',
        billed_amount: 3240,
        collected_amount: 3240,
        collected_at: '2026-06-16T00:00:00.000Z',
        receipt_number: '未発行',
      }),
      { params: Promise.resolve({ id: 'candidate_1' }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '領収証番号と発行状態を入力してください',
      details: {
        receipt_number: expect.arrayContaining([
          '領収証発行が必要な患者では集金時に領収証番号が必須です',
        ]),
        receipt_issue_status: expect.arrayContaining([
          '領収証発行が必要な患者では集金時に発行済み状態が必須です',
        ]),
      },
    });
    expect(taskFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        task_type: 'patient_billing_payment_profile',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
      },
      orderBy: [{ updated_at: 'desc' }],
      select: { metadata: true },
    });
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects collected payments when receipt status is not issued', async () => {
    const response = await PATCH(
      createRequest({
        status: 'collected',
        billed_amount: 3240,
        collected_amount: 3240,
        collected_at: '2026-06-16T00:00:00.000Z',
        receipt_number: 'R20260616-001',
        receipt_issue_status: 'not_issued',
      }),
      { params: Promise.resolve({ id: 'candidate_1' }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '領収証番号と発行状態を入力してください',
    });
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects billable collection history when invoice issuance is required but not issued', async () => {
    taskFindFirstMock.mockResolvedValue({
      metadata: {
        receipt_issue: 'none',
        invoice_issue: 'yes',
      },
    });

    const response = await PATCH(
      createRequest({
        status: 'billed',
        billed_amount: 3240,
        collected_amount: 0,
        invoice_issue_status: 'not_issued',
      }),
      { params: Promise.resolve({ id: 'candidate_1' }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '請求書の発行状態を入力してください',
      details: {
        invoice_issue_status: expect.arrayContaining([
          '請求書発行が必要な患者では請求・集金時に発行済み状態が必須です',
        ]),
      },
    });
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('allows collected payments without receipt numbers when receipt issuance is disabled', async () => {
    taskFindFirstMock.mockResolvedValue({
      metadata: {
        receipt_issue: 'none',
      },
    });

    const response = await PATCH(
      createRequest({
        status: 'collected',
        billed_amount: 3240,
        collected_amount: 3240,
        collected_at: '2026-06-16T00:00:00.000Z',
      }),
      { params: Promise.resolve({ id: 'candidate_1' }) },
    );

    expect(response.status).toBe(200);
    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          calculation_breakdown: expect.objectContaining({
            collection: expect.objectContaining({
              status: 'collected',
              receipt_number: null,
              receipt_issue_status: 'not_required',
              receipt_copy_url: null,
            }),
          }),
        },
      }),
    );
  });

  it('rejects collected amounts greater than billed amounts', async () => {
    const response = await PATCH(
      createRequest({
        status: 'partial',
        billed_amount: 1000,
        collected_amount: 2000,
      }),
      { params: Promise.resolve({ id: 'candidate_1' }) },
    );

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects collected status when the payment is incomplete', async () => {
    const response = await PATCH(
      createRequest({
        status: 'collected',
        billed_amount: 3240,
        collected_amount: 2160,
        collected_at: '2026-06-16T00:00:00.000Z',
      }),
      { params: Promise.resolve({ id: 'candidate_1' }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        collected_amount: expect.arrayContaining(['集金済では入金額を請求額と一致させてください']),
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects collected status without a collected timestamp', async () => {
    const response = await PATCH(
      createRequest({
        status: 'collected',
        billed_amount: 3240,
        collected_amount: 3240,
      }),
      { params: Promise.resolve({ id: 'candidate_1' }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: { collected_at: expect.arrayContaining(['集金済では入金日時が必須です']) },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects partial status when the amount is fully collected', async () => {
    const response = await PATCH(
      createRequest({
        status: 'partial',
        billed_amount: 3240,
        collected_amount: 3240,
        collected_at: '2026-06-16T00:00:00.000Z',
      }),
      { params: Promise.resolve({ id: 'candidate_1' }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        collected_amount: expect.arrayContaining(['一部入金では入金額を請求額未満にしてください']),
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects scheduled collection without a scheduled date', async () => {
    const response = await PATCH(
      createRequest({
        status: 'scheduled',
        billed_amount: 3240,
        collected_amount: 0,
      }),
      { params: Promise.resolve({ id: 'candidate_1' }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: { scheduled_collection_at: expect.arrayContaining(['集金予定日は必須です']) },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the candidate is missing', async () => {
    findFirstMock.mockResolvedValue(null);

    const response = await PATCH(createRequest({ status: 'billed', billed_amount: 3240 }), {
      params: Promise.resolve({ id: 'candidate_1' }),
    });

    expect(response.status).toBe(404);
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns 409 when the candidate changed after it was read', async () => {
    updateManyMock.mockResolvedValue({ count: 0 });

    const response = await PATCH(createRequest({ status: 'billed', billed_amount: 3240 }), {
      params: Promise.resolve({ id: 'candidate_1' }),
    });

    expect(response.status).toBe(409);
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});
