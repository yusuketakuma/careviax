import { createHash, createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  findFirstMock,
  patientFindFirstMock,
  updateManyMock,
  findUniqueMock,
  taskFindFirstMock,
  auditLogCreateMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  findFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
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

const CURRENT_UPDATED_AT = '2026-06-01T00:00:00.000Z';
const LOCAL_AUTH_SECRET = 'ph-os-local-auth-secret';

function createRequest(body: unknown, headers: Record<string, string> = {}) {
  const requestBody =
    body && typeof body === 'object' && !Array.isArray(body) && !('expected_updated_at' in body)
      ? { expected_updated_at: CURRENT_UPDATED_AT, ...body }
      : body;
  return new NextRequest('http://localhost/api/billing-candidates/candidate_1/collection', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
      ...headers,
    },
    body: JSON.stringify(requestBody),
  });
}

function hashJson(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function keyedHashJson(value: unknown) {
  return createHmac('sha256', LOCAL_AUTH_SECRET).update(JSON.stringify(value)).digest('hex');
}

function buildIdempotencyKeyHash(idempotencyKey: string) {
  return `billing-collection:v1:${keyedHashJson({
    purpose: 'billing_collection_idempotency_key',
    org_id: 'org_1',
    candidate_id: 'candidate_1',
    idempotency_key: idempotencyKey,
  })}`;
}

function buildRequestFingerprint(body: Record<string, unknown>) {
  return `billing-collection-request:v1:${hashJson({
    candidate_id: 'candidate_1',
    expected_updated_at: body.expected_updated_at,
    status: body.status,
    billed_amount: body.billed_amount ?? null,
    collected_amount: body.collected_amount ?? null,
    payment_method: body.payment_method ?? null,
    payer_name: body.payer_name ?? null,
    billed_at: body.billed_at ? new Date(String(body.billed_at)).toISOString() : null,
    scheduled_collection_at: body.scheduled_collection_at
      ? new Date(String(body.scheduled_collection_at)).toISOString()
      : null,
    collected_at: body.collected_at ? new Date(String(body.collected_at)).toISOString() : null,
    receipt_number: body.receipt_number ?? null,
    receipt_issue_status: body.receipt_issue_status ?? null,
    invoice_issue_status: body.invoice_issue_status ?? null,
    save_receipt_copy: body.save_receipt_copy ?? false,
    save_invoice_copy: body.save_invoice_copy ?? false,
    unpaid_reason: body.unpaid_reason ?? null,
    note: body.note ?? null,
  })}`;
}

describe('/api/billing-candidates/[id]/collection PATCH', () => {
  const updatedAt = new Date(CURRENT_UPDATED_AT);

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
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1', archived_at: null });
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
        patient: {
          findFirst: patientFindFirstMock,
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
        save_invoice_copy: true,
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
            save_invoice_copy: true,
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

  it('encodes billing document copy URLs while keeping the raw candidate id for billing writes and audit', async () => {
    const hostileCandidateId = 'candidate/1?tab=x#frag';

    const response = await PATCH(
      createRequest({
        status: 'partial',
        billed_amount: 3240,
        collected_amount: 2160,
        payment_method: 'cash',
        collected_at: '2026-06-16T00:00:00.000Z',
        receipt_number: 'R20260616-001',
        receipt_issue_status: 'issued',
        invoice_issue_status: 'issued',
        save_receipt_copy: true,
        save_invoice_copy: true,
      }),
      { params: Promise.resolve({ id: hostileCandidateId }) },
    );

    expect(response.status).toBe(200);
    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: hostileCandidateId,
          org_id: 'org_1',
        }),
      }),
    );
    expect(updateManyMock).toHaveBeenCalledWith({
      where: {
        id: hostileCandidateId,
        org_id: 'org_1',
        updated_at: updatedAt,
      },
      data: {
        calculation_breakdown: expect.objectContaining({
          collection: expect.objectContaining({
            receipt_copy_url: `/api/billing-candidates/${encodeURIComponent(
              hostileCandidateId,
            )}/documents/pdf?kind=receipt`,
            invoice_copy_url: `/api/billing-candidates/${encodeURIComponent(
              hostileCandidateId,
            )}/documents/pdf?kind=invoice`,
          }),
        }),
      },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          target_id: hostileCandidateId,
        }),
      }),
    );
  });

  it.each(['.', '..'])(
    'rejects exact dot-segment candidate ids before loading billing data: %s',
    async (candidateId) => {
      const response = await PATCH(
        createRequest({
          status: 'billed',
          billed_amount: 3240,
          collected_amount: 0,
          invoice_issue_status: 'issued',
        }),
        { params: Promise.resolve({ id: candidateId }) },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        message: '請求候補IDが不正です',
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(updateManyMock).not.toHaveBeenCalled();
      expect(auditLogCreateMock).not.toHaveBeenCalled();
    },
  );

  it('stores hashed idempotency metadata for keyed collection updates without exposing it in audit changes', async () => {
    const requestBody = {
      status: 'billed',
      billed_amount: 3240,
      collected_amount: 0,
      invoice_issue_status: 'issued',
    };

    const response = await PATCH(
      createRequest(requestBody, { 'Idempotency-Key': 'collection-key-1' }),
      { params: Promise.resolve({ id: 'candidate_1' }) },
    );

    expect(response.status).toBe(200);
    const idempotencyKeyHash = buildIdempotencyKeyHash('collection-key-1');
    const requestFingerprint = buildRequestFingerprint({
      expected_updated_at: CURRENT_UPDATED_AT,
      ...requestBody,
      save_receipt_copy: false,
      save_invoice_copy: false,
    });
    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          calculation_breakdown: expect.objectContaining({
            collection: expect.objectContaining({
              status: 'billed',
              idempotency_key_hash: idempotencyKeyHash,
              idempotency_request_fingerprint: requestFingerprint,
            }),
          }),
        },
      }),
    );
    const auditChanges = auditLogCreateMock.mock.calls[0]?.[0]?.data?.changes as
      | { collection?: Record<string, unknown> }
      | undefined;
    expect(auditChanges?.collection).not.toHaveProperty('idempotency_key_hash');
    expect(auditChanges?.collection).not.toHaveProperty('idempotency_request_fingerprint');
  });

  it('replays the same idempotency key and body without duplicate update or audit side effects', async () => {
    const requestBody = {
      status: 'billed',
      billed_amount: 3240,
      collected_amount: 0,
      invoice_issue_status: 'issued',
    };
    const idempotencyKeyHash = buildIdempotencyKeyHash('collection-key-1');
    const requestFingerprint = buildRequestFingerprint({
      expected_updated_at: CURRENT_UPDATED_AT,
      ...requestBody,
      save_receipt_copy: false,
      save_invoice_copy: false,
    });
    findFirstMock.mockResolvedValueOnce({
      id: 'candidate_1',
      patient_id: 'patient_1',
      billing_target_type: 'patient',
      billing_target_id: 'patient_1',
      status: 'confirmed',
      calculation_breakdown: {
        amount_yen: 3240,
        collection: {
          status: 'billed',
          idempotency_key_hash: idempotencyKeyHash,
          idempotency_request_fingerprint: requestFingerprint,
        },
      },
      updated_at: new Date('2026-06-01T00:01:00.000Z'),
    });

    const response = await PATCH(
      createRequest(requestBody, { 'Idempotency-Key': 'collection-key-1' }),
      { params: Promise.resolve({ id: 'candidate_1' }) },
    );

    expect(response.status).toBe(200);
    expect(findUniqueMock).toHaveBeenCalledWith({ where: { id: 'candidate_1' } });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(taskFindFirstMock).not.toHaveBeenCalled();
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects an idempotency key reused with a different collection body', async () => {
    findFirstMock.mockResolvedValueOnce({
      id: 'candidate_1',
      patient_id: 'patient_1',
      billing_target_type: 'patient',
      billing_target_id: 'patient_1',
      status: 'confirmed',
      calculation_breakdown: {
        amount_yen: 3240,
        collection: {
          status: 'billed',
          idempotency_key_hash: buildIdempotencyKeyHash('collection-key-1'),
          idempotency_request_fingerprint: 'billing-collection-request:v1:different',
        },
      },
      updated_at: updatedAt,
    });

    const response = await PATCH(
      createRequest(
        {
          status: 'billed',
          billed_amount: 3240,
          collected_amount: 0,
          invoice_issue_status: 'issued',
        },
        { 'Idempotency-Key': 'collection-key-1' },
      ),
      { params: Promise.resolve({ id: 'candidate_1' }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      message: 'Idempotency-Keyが別の集金記録リクエストで使用されています',
      details: { reason: 'key_reused_with_different_request' },
    });
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('does not save an invoice copy URL unless staff explicitly requests it', async () => {
    const response = await PATCH(
      createRequest({
        status: 'billed',
        billed_amount: 3240,
        collected_amount: 0,
        invoice_issue_status: 'issued',
      }),
      { params: Promise.resolve({ id: 'candidate_1' }) },
    );

    expect(response.status).toBe(200);
    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          calculation_breakdown: expect.objectContaining({
            collection: expect.objectContaining({
              status: 'billed',
              invoice_issue_status: 'issued',
              save_invoice_copy: false,
              invoice_copy_url: null,
            }),
          }),
        },
      }),
    );
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

  it('rejects archived patients before writing collection metadata', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

    const response = await PATCH(
      createRequest({
        status: 'billed',
        billed_amount: 3240,
        collected_amount: 0,
        invoice_issue_status: 'issued',
      }),
      { params: Promise.resolve({ id: 'candidate_1' }) },
    );

    expect(response.status).toBe(409);
    expect(taskFindFirstMock).not.toHaveBeenCalled();
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

  it('requires expected_updated_at before loading the candidate for mutation work', async () => {
    const response = await PATCH(
      createRequest({
        expected_updated_at: undefined,
        status: 'billed',
        billed_amount: 3240,
      }),
      { params: Promise.resolve({ id: 'candidate_1' }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: { expected_updated_at: expect.any(Array) },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects malformed idempotency keys before loading the candidate', async () => {
    const response = await PATCH(
      createRequest(
        {
          status: 'billed',
          billed_amount: 3240,
        },
        { 'Idempotency-Key': 'bad key with spaces' },
      ),
      { params: Promise.resolve({ id: 'candidate_1' }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'Idempotency-Keyが不正です',
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

  it('returns 409 for stale expected_updated_at before patient, task, update, or audit side effects', async () => {
    const response = await PATCH(
      createRequest({
        expected_updated_at: '2026-05-31T23:59:59.000Z',
        status: 'billed',
        billed_amount: 3240,
      }),
      { params: Promise.resolve({ id: 'candidate_1' }) },
    );

    expect(response.status).toBe(409);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(taskFindFirstMock).not.toHaveBeenCalled();
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
