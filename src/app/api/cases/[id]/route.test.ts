import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  careCaseFindFirstMock,
  firstVisitDocumentFindFirstMock,
  validateOrgReferencesMock,
  careCaseUpdateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  firstVisitDocumentFindFirstMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  careCaseUpdateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
    firstVisitDocument: {
      findFirst: firstVisitDocumentFindFirstMock,
    },
  },
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, PATCH } from './route';

function createGetRequest() {
  return new NextRequest('http://localhost/api/cases/case_1');
}

function createPatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/cases/case_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMalformedPatchRequest() {
  return new NextRequest('http://localhost/api/cases/case_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{"primary_pharmacist_id":',
  });
}

describe('/api/cases/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    careCaseFindFirstMock.mockResolvedValue({
      id: 'case_1',
      org_id: 'org_1',
      patient: {
        id: 'patient_1',
        name: '患者 太郎',
        name_kana: 'カンジャ タロウ',
      },
    });
    firstVisitDocumentFindFirstMock.mockResolvedValue(null);
    validateOrgReferencesMock.mockResolvedValue({ ok: true });
    careCaseUpdateMock.mockResolvedValue({
      id: 'case_1',
      primary_pharmacist_id: null,
      backup_pharmacist_id: 'pharmacist_2',
      required_visit_support: { escort: true },
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        careCase: {
          update: careCaseUpdateMock,
        },
      }),
    );
  });

  it('scopes GET by case assignment before returning patient details', async () => {
    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'case_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(careCaseFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'case_1',
        org_id: 'org_1',
      },
      include: {
        patient: {
          select: {
            id: true,
            name: true,
            name_kana: true,
          },
        },
      },
    });
    expect(firstVisitDocumentFindFirstMock).toHaveBeenCalledWith({
      where: { case_id: 'case_1', org_id: 'org_1' },
      select: {
        id: true,
        delivered_at: true,
        delivered_to: true,
        document_url: true,
        created_at: true,
      },
    });
  });

  it('serializes first visit document delivery state with no-store headers', async () => {
    firstVisitDocumentFindFirstMock.mockResolvedValueOnce({
      id: 'doc_1',
      delivered_at: new Date('2026-06-12T10:00:00.000Z'),
      delivered_to: '家族A',
      document_url: 'https://example.test/first-visit-doc.pdf',
      created_at: new Date('2026-06-10T09:00:00.000Z'),
    });

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'case_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'case_1',
        first_visit_doc: {
          id: 'doc_1',
          delivered_at: '2026-06-12T10:00:00.000Z',
          delivered_to: '家族A',
          document_url: 'https://example.test/first-visit-doc.pdf',
          created_at: '2026-06-10T09:00:00.000Z',
        },
        first_visit_doc_delivered: true,
      },
    });
  });

  it('rejects blank case ids before loading case details', async () => {
    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'ケースIDが不正です',
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(firstVisitDocumentFindFirstMock).not.toHaveBeenCalled();
  });

  it('does not fetch first visit document details for an unassigned case', async () => {
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'case_2' }),
    }))!;

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(firstVisitDocumentFindFirstMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when case detail lookup fails unexpectedly', async () => {
    careCaseFindFirstMock.mockRejectedValueOnce(
      new Error('患者 山田花子 東京都千代田区1-1-1 アムロジピン raw case detail'),
    );

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'case_1' }),
    }))!;

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田花子');
    expect(JSON.stringify(body)).not.toContain('東京都千代田区1-1-1');
    expect(JSON.stringify(body)).not.toContain('アムロジピン');
    expect(JSON.stringify(body)).not.toContain('raw case detail');
    expect(firstVisitDocumentFindFirstMock).not.toHaveBeenCalled();
  });

  it('updates a case and normalizes empty pharmacist ids to null', async () => {
    const response = (await PATCH(
      createPatchRequest({
        primary_pharmacist_id: '',
        backup_pharmacist_id: 'pharmacist_2',
        required_visit_support: { escort: true, internal_note: undefined },
      }),
      {
        params: Promise.resolve({ id: 'case_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(careCaseFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'case_1',
        org_id: 'org_1',
      },
    });
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      pharmacist_ids: ['pharmacist_2'],
    });
    expect(careCaseUpdateMock).toHaveBeenCalledWith({
      where: { id: 'case_1' },
      data: expect.objectContaining({
        primary_pharmacist_id: null,
        backup_pharmacist_id: 'pharmacist_2',
        required_visit_support: { escort: true },
      }),
    });
    expect(
      (careCaseUpdateMock.mock.calls[0][0].data.required_visit_support as Record<string, unknown>)
        .internal_note,
    ).toBeUndefined();
  });

  it('validates both primary and backup pharmacist ids together', async () => {
    const response = (await PATCH(
      createPatchRequest({
        primary_pharmacist_id: 'pharmacist_1',
        backup_pharmacist_id: 'pharmacist_2',
      }),
      {
        params: Promise.resolve({ id: 'case_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    // both ids must be validated — not just one (regression guard against same-key spread)
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      pharmacist_ids: ['pharmacist_1', 'pharmacist_2'],
    });
  });

  it('rejects pharmacist assignment when a pharmacist id is not an eligible org member', async () => {
    validateOrgReferencesMock.mockResolvedValueOnce({
      ok: false,
      response: Response.json(
        { error: '指定された薬剤師はこの組織に所属していません' },
        { status: 400 },
      ),
    });
    const response = (await PATCH(
      createPatchRequest({
        primary_pharmacist_id: 'outsider',
        backup_pharmacist_id: 'pharmacist_2',
      }),
      {
        params: Promise.resolve({ id: 'case_1' }),
      },
    ))!;
    expect(response.status).toBe(400);
    expect(careCaseUpdateMock).not.toHaveBeenCalled();
  });

  it('assigns staff, normalizes empty staff ids to null, and validates only the supplied staff ids', async () => {
    const response = (await PATCH(
      createPatchRequest({
        primary_staff_id: '',
        backup_staff_id: 'staff_2',
      }),
      {
        params: Promise.resolve({ id: 'case_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    // empty primary -> excluded from validation; backup is validated as an org member
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      staff_ids: ['staff_2'],
    });
    expect(careCaseUpdateMock).toHaveBeenCalledWith({
      where: { id: 'case_1' },
      data: expect.objectContaining({
        primary_staff_id: null,
        backup_staff_id: 'staff_2',
      }),
    });
  });

  it('rejects staff assignment when the staff id is not an org member', async () => {
    validateOrgReferencesMock.mockResolvedValueOnce({
      ok: false,
      response: Response.json(
        { error: '指定されたスタッフはこの組織に所属していません' },
        { status: 400 },
      ),
    });
    const response = (await PATCH(createPatchRequest({ primary_staff_id: 'outsider' }), {
      params: Promise.resolve({ id: 'case_1' }),
    }))!;
    expect(response.status).toBe(400);
    expect(careCaseUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object patch payloads before loading the case', async () => {
    const response = (await PATCH(createPatchRequest([]), {
      params: Promise.resolve({ id: 'case_1' }),
    }))!;

    expect(response.status).toBe(400);
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careCaseUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects blank case ids before loading or updating the case', async () => {
    const response = (await PATCH(
      createPatchRequest({
        primary_pharmacist_id: 'pharmacist_2',
      }),
      {
        params: Promise.resolve({ id: '   ' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'ケースIDが不正です',
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careCaseUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before loading the case', async () => {
    const response = (await PATCH(createMalformedPatchRequest(), {
      params: Promise.resolve({ id: 'case_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careCaseUpdateMock).not.toHaveBeenCalled();
  });

  it('denies unassigned case PATCH before reference validation or updates', async () => {
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      createPatchRequest({
        primary_pharmacist_id: 'user_1',
      }),
      {
        params: Promise.resolve({ id: 'case_2' }),
      },
    ))!;

    expect(response.status).toBe(404);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careCaseUpdateMock).not.toHaveBeenCalled();
  });

  it('clears optional dates and text fields when empty strings are provided', async () => {
    const response = (await PATCH(
      createPatchRequest({
        referral_source: '',
        start_date: '',
        end_date: '',
        end_reason: '',
        notes: '',
      }),
      {
        params: Promise.resolve({ id: 'case_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(careCaseUpdateMock).toHaveBeenCalledWith({
      where: { id: 'case_1' },
      data: expect.objectContaining({
        referral_source: null,
        start_date: null,
        end_date: null,
        end_reason: null,
        notes: null,
      }),
    });
  });
});
