import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  patientFindFirstMock,
  fieldRevisionFindManyMock,
  userFindManyMock,
  requireAuthContextMock,
} = vi.hoisted(() => ({
  patientFindFirstMock: vi.fn(),
  fieldRevisionFindManyMock: vi.fn(),
  userFindManyMock: vi.fn(),
  requireAuthContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: { findFirst: patientFindFirstMock },
    patientFieldRevision: { findMany: fieldRevisionFindManyMock },
    user: { findMany: userFindManyMock },
  },
}));

import { GET } from './route';

function createRequest(search = '') {
  return new NextRequest(`http://localhost/api/patients/patient_1/field-revisions${search}`, {
    headers: { 'x-org-id': 'org_1' },
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
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
  });

  it('変更履歴を整形し更新者名を解決して返す', async () => {
    const response = await GET(createRequest(), params);
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const body = (await response.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      field_key: 'care_level',
      current: 'care_4',
      updated_by_name: '田中',
    });
  });

  it('category フィルタをクエリへ渡す', async () => {
    fieldRevisionFindManyMock.mockResolvedValue([]);
    await GET(createRequest('?category=basic'), params);
    expect(fieldRevisionFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ category: 'basic' }) }),
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

  it('アクセスできない患者は 404', async () => {
    patientFindFirstMock.mockResolvedValue(null);
    const response = await GET(createRequest(), params);
    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(fieldRevisionFindManyMock).not.toHaveBeenCalled();
  });

  it('権限が無い場合は auth レスポンスを返す', async () => {
    requireAuthContextMock.mockResolvedValue({
      response: new Response('forbidden', { status: 403 }),
    });
    const response = await GET(createRequest(), params);
    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
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
  });
});
