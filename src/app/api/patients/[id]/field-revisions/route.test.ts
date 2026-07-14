import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  patientFindFirstMock,
  fieldRevisionFindManyMock,
  fieldRevisionCountMock,
  userFindManyMock,
  requireAuthContextMock,
  recordPhiReadAuditForRequestMock,
} = vi.hoisted(() => ({
  patientFindFirstMock: vi.fn(),
  fieldRevisionFindManyMock: vi.fn(),
  fieldRevisionCountMock: vi.fn(),
  userFindManyMock: vi.fn(),
  requireAuthContextMock: vi.fn(),
  recordPhiReadAuditForRequestMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/audit/phi-read-audit', () => ({
  recordPhiReadAuditForRequest: recordPhiReadAuditForRequestMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: { findFirst: patientFindFirstMock },
    patientFieldRevision: { findMany: fieldRevisionFindManyMock, count: fieldRevisionCountMock },
    user: { findMany: userFindManyMock },
  },
}));

import { GET } from './route';

function createRequest(search = '') {
  return new NextRequest(`http://localhost/api/patients/patient_1/field-revisions${search}`, {
    headers: { 'x-org-id': 'org_1' },
  });
}

const params = { params: Promise.resolve({ id: 'patient_1' }) };

const baseRow = {
  id: 'rev_1',
  category: 'clinical',
  field_key: 'care_level',
  field_label: '介護度',
  value_label: 'care_2 → care_4',
  old_value: 'care_2',
  new_value: 'care_4',
  source: 'patient_detail_edit',
  source_visit_record_id: null,
  change_reason: null,
  importance: 'normal',
  confirmed_by: null,
  confirmed_at: null,
  valid_from: new Date('2026-06-16T00:00:00Z'),
  valid_to: null,
  is_current: true,
  updated_by: 'user_u',
  created_at: new Date('2026-06-16T01:00:00Z'),
};

describe('GET /api/patients/[id]/field-revisions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
    });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    userFindManyMock.mockResolvedValue([{ id: 'user_u', name: '田中' }]);
    fieldRevisionFindManyMock.mockResolvedValue([baseRow]);
    fieldRevisionCountMock.mockResolvedValue(1);
  });

  it('変更履歴を整形し更新者名を解決して返す', async () => {
    const response = await GET(createRequest(), params);
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const body = (await response.json()) as {
      data: Array<Record<string, unknown>>;
      meta: Record<string, unknown>;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      field_key: 'care_level',
      current: 'care_4',
      updated_by_name: '田中',
    });
    expect(body.meta).toMatchObject({
      total_count: 1,
      visible_count: 1,
      hidden_count: 0,
      truncated: false,
      count_basis: 'patient_field_revisions',
    });
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledTimes(1);
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }),
      {
        patientId: 'patient_1',
        targetType: 'patient',
        targetId: 'patient_1',
        view: 'patient_field_revision_list',
      },
    );
  });

  it('returns exact sensitive revision values for known internal staff', async () => {
    fieldRevisionFindManyMock.mockResolvedValue([
      {
        ...baseRow,
        field_key: 'phone',
        field_label: '電話番号',
        value_label: '090-0000-0000 → 080-1111-2222',
        old_value: '090-0000-0000',
        new_value: '080-1111-2222',
        change_reason: '家族から連絡あり',
      },
    ]);

    const response = await GET(createRequest(), params);

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          value_label: '090-0000-0000 → 080-1111-2222',
          previous: '090-0000-0000',
          current: '080-1111-2222',
          change_reason: '家族から連絡あり',
        }),
      ],
    });
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledTimes(1);
  });

  it('keeps sensitive revision values masked for external viewers', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: { orgId: 'org_1', userId: 'user_ext', role: 'external_viewer' },
    });
    fieldRevisionFindManyMock.mockResolvedValue([
      {
        ...baseRow,
        field_key: 'phone',
        field_label: '電話番号',
        value_label: '090-0000-0000 → 080-1111-2222',
        old_value: '090-0000-0000',
        new_value: '080-1111-2222',
        change_reason: '家族から連絡あり',
      },
    ]);

    const response = await GET(createRequest(), params);

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          value_label: null,
          previous: '〔記録あり〕',
          current: '〔記録あり〕',
          change_reason: null,
        }),
      ],
    });
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledTimes(1);
  });

  it('category and limit filters are reflected in the counted response metadata', async () => {
    fieldRevisionFindManyMock.mockResolvedValue([]);
    fieldRevisionCountMock.mockResolvedValue(3);
    const response = await GET(createRequest('?category=basic&limit=1'), params);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [],
      meta: {
        total_count: 3,
        visible_count: 0,
        hidden_count: 3,
        truncated: true,
        count_basis: 'patient_field_revisions',
        filters_applied: { category: 'basic' },
        sort_basis: 'created_at_desc',
        limit: 1,
      },
    });
    expect(fieldRevisionCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({ category: 'basic' }),
    });
    expect(fieldRevisionFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ category: 'basic' }),
        take: 1,
      }),
    );
  });

  it('医療処置カテゴリもUIフィルタと同じ定義で受け付ける', async () => {
    fieldRevisionFindManyMock.mockResolvedValue([]);
    const response = await GET(createRequest('?category=medical_care'), params);
    expect(response.status).toBe(200);
    expect(fieldRevisionFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ category: 'medical_care' }) }),
    );
  });

  it('rejects blank patient ids before queries or read audit', async () => {
    const response = await GET(createRequest(), { params: Promise.resolve({ id: '   ' }) });

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(fieldRevisionFindManyMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('rejects invalid query parameters before patient lookup or read audit', async () => {
    const response = await GET(createRequest('?limit=0'), params);

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(fieldRevisionFindManyMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('アクセスできない患者は 404', async () => {
    patientFindFirstMock.mockResolvedValue(null);
    const response = await GET(createRequest(), params);
    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(fieldRevisionFindManyMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('権限が無い場合は auth レスポンスを返す', async () => {
    requireAuthContextMock.mockResolvedValue({
      response: new Response('forbidden', { status: 403 }),
    });
    const response = await GET(createRequest(), params);
    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('raw details are omitted from sanitized no-store 500 responses', async () => {
    const rawError = '患者A care_level モルヒネ field revision failure';
    fieldRevisionFindManyMock.mockRejectedValueOnce(new Error(rawError));

    const response = await GET(createRequest(), params);

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(JSON.stringify(body)).not.toContain('患者A');
    expect(JSON.stringify(body)).not.toContain('モルヒネ');
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });
});
