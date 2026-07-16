import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withAuthContextMock,
  careCaseFindFirstMock,
  firstVisitDocumentFindFirstMock,
  recordPhiReadAuditForRequestMock,
  txCareCaseFindFirstMock,
  careCaseUpdateManyMock,
  membershipFindFirstMock,
  membershipFindManyMock,
  writePatientFieldRevisionsMock,
  createAuditLogEntryMock,
  withOrgContextMock,
} = vi.hoisted(() => {
  const requireAuthContextMock = vi.fn();
  const withAuthContextMock = vi.fn(
    (
      handler: (
        req: NextRequest,
        ctx: { orgId: string; userId: string; role: string },
        routeContext: { params: Promise<{ id: string }> },
      ) => Promise<Response>,
      options: unknown,
    ) => {
      return async (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) => {
        const authResult = await requireAuthContextMock(req, options);
        let response: Response;
        if (authResult && typeof authResult === 'object' && 'response' in authResult) {
          response = authResult.response;
        } else {
          try {
            response = await handler(req, authResult.ctx, routeContext);
          } catch {
            response = new Response(
              JSON.stringify({
                code: 'INTERNAL_ERROR',
                message: 'サーバー内部でエラーが発生しました',
              }),
              { status: 500, headers: { 'Content-Type': 'application/json' } },
            );
          }
        }
        response.headers.set('Cache-Control', 'private, no-store, max-age=0');
        response.headers.set('Pragma', 'no-cache');
        response.headers.set('X-Request-Id', '00000000-0000-4000-8000-000000000001');
        response.headers.set(
          'X-Correlation-Id',
          req.headers.get('x-correlation-id') ?? '00000000-0000-4000-8000-000000000001',
        );
        return response;
      };
    },
  );

  return {
    requireAuthContextMock,
    withAuthContextMock,
    careCaseFindFirstMock: vi.fn(),
    firstVisitDocumentFindFirstMock: vi.fn(),
    recordPhiReadAuditForRequestMock: vi.fn(),
    txCareCaseFindFirstMock: vi.fn(),
    careCaseUpdateManyMock: vi.fn(),
    membershipFindFirstMock: vi.fn(),
    membershipFindManyMock: vi.fn(),
    writePatientFieldRevisionsMock: vi.fn(),
    createAuditLogEntryMock: vi.fn(),
    withOrgContextMock: vi.fn(),
  };
});

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: withAuthContextMock,
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

vi.mock('@/lib/audit/phi-read-audit', () => ({
  recordPhiReadAuditForRequest: recordPhiReadAuditForRequestMock,
}));

vi.mock('@/server/services/patient-field-revision', () => ({
  writePatientFieldRevisions: writePatientFieldRevisionsMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, PATCH } from './route';

function createGetRequest() {
  return new NextRequest('http://localhost/api/cases/case_1', {
    headers: { 'x-correlation-id': 'case_get_test' },
  });
}

function createPatchRequest(body: unknown) {
  const payload =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? { version: 1, ...body }
      : body;
  return new NextRequest('http://localhost/api/cases/case_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-correlation-id': 'case_patch_test' },
    body: JSON.stringify(payload),
  });
}

function createMalformedPatchRequest() {
  return new NextRequest('http://localhost/api/cases/case_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-correlation-id': 'case_patch_test' },
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
    txCareCaseFindFirstMock
      .mockReset()
      .mockResolvedValueOnce({
        id: 'case_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        status: 'active',
        version: 1,
        primary_pharmacist_id: null,
        backup_pharmacist_id: null,
        primary_staff_id: null,
        backup_staff_id: null,
        required_visit_support: {},
      })
      .mockResolvedValue({
        id: 'case_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        status: 'active',
        version: 2,
        primary_pharmacist_id: null,
        backup_pharmacist_id: 'pharmacist_2',
        required_visit_support: { escort: true },
      });
    firstVisitDocumentFindFirstMock.mockResolvedValue(null);
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    membershipFindManyMock.mockImplementation(async ({ where }) =>
      (where.user_id.in as string[]).map((userId) => ({ user_id: userId, role: 'pharmacist' })),
    );
    careCaseUpdateManyMock.mockResolvedValue({ count: 1 });
    writePatientFieldRevisionsMock.mockResolvedValue(1);
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        membership: {
          findFirst: membershipFindFirstMock,
          findMany: membershipFindManyMock,
        },
        careCase: {
          findFirst: txCareCaseFindFirstMock,
          updateMany: careCaseUpdateManyMock,
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
    expect(response.headers.get('X-Request-Id')).toBe('00000000-0000-4000-8000-000000000001');
    expect(response.headers.get('X-Correlation-Id')).toBe('case_get_test');
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canViewDashboard',
      message: 'ケース参照の権限がありません',
    });
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
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }),
      {
        patientId: 'patient_1',
        targetType: 'care_case',
        targetId: 'case_1',
        view: 'care_case_detail',
      },
    );
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledTimes(1);
    const auditPayload = JSON.stringify(recordPhiReadAuditForRequestMock.mock.calls[0]?.[1]);
    expect(auditPayload).not.toContain('患者 太郎');
    expect(auditPayload).not.toContain('カンジャ タロウ');
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
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
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
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('does not audit or return case detail when first visit document lookup fails', async () => {
    firstVisitDocumentFindFirstMock.mockRejectedValueOnce(
      new Error('患者 山田花子 raw first visit document detail'),
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
    expect(JSON.stringify(body)).not.toContain('raw first visit document detail');
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('does not read or audit case detail when authentication is rejected', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), { status: 401 }),
    });

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'case_1' }),
    }))!;

    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(firstVisitDocumentFindFirstMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
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
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
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
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(response.headers.get('X-Request-Id')).toBe('00000000-0000-4000-8000-000000000001');
    expect(response.headers.get('X-Correlation-Id')).toBe('case_patch_test');
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canVisit',
      message: 'ケース更新の権限がありません',
    });
    expect(txCareCaseFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'case_1',
        org_id: 'org_1',
      },
    });
    expect(membershipFindManyMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1', user_id: { in: ['pharmacist_2'] }, is_active: true },
      select: { user_id: true, role: true },
    });
    expect(careCaseUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'case_1', org_id: 'org_1', status: 'active', version: 1 },
      data: expect.objectContaining({
        primary_pharmacist_id: null,
        backup_pharmacist_id: 'pharmacist_2',
        required_visit_support: { escort: true },
        version: { increment: 1 },
      }),
    });
    expect(
      (
        careCaseUpdateManyMock.mock.calls[0][0].data.required_visit_support as Record<
          string,
          unknown
        >
      ).internal_note,
    ).toBeUndefined();
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        id: 'case_1',
        primary_pharmacist_id: null,
        backup_pharmacist_id: 'pharmacist_2',
        required_visit_support: { escort: true },
      },
    });
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('primary_pharmacist_id');
    expect(body).not.toHaveProperty('required_visit_support');
    expect(writePatientFieldRevisionsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ caseId: 'case_1', source: 'care_case_edit' }),
    );
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: 'care_case_updated', targetId: 'case_1' }),
    );
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
    expect(membershipFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        user_id: { in: ['pharmacist_1', 'pharmacist_2'] },
        is_active: true,
      },
      select: { user_id: true, role: true },
    });
  });

  it('rejects pharmacist assignment when a pharmacist id is not an eligible org member', async () => {
    membershipFindManyMock.mockResolvedValueOnce([{ user_id: 'pharmacist_2', role: 'pharmacist' }]);
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
    expect(careCaseUpdateManyMock).not.toHaveBeenCalled();
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
    expect(membershipFindManyMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1', user_id: { in: ['staff_2'] }, is_active: true },
      select: { user_id: true, role: true },
    });
    expect(careCaseUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'case_1', org_id: 'org_1', status: 'active', version: 1 },
      data: expect.objectContaining({
        primary_staff_id: null,
        backup_staff_id: 'staff_2',
      }),
    });
  });

  it('rejects staff assignment when the staff id is not an org member', async () => {
    membershipFindManyMock.mockResolvedValueOnce([]);
    const response = (await PATCH(createPatchRequest({ primary_staff_id: 'outsider' }), {
      params: Promise.resolve({ id: 'case_1' }),
    }))!;
    expect(response.status).toBe(400);
    expect(careCaseUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects non-object patch payloads before loading the case', async () => {
    const response = (await PATCH(createPatchRequest([]), {
      params: Promise.resolve({ id: 'case_1' }),
    }))!;

    expect(response.status).toBe(400);
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careCaseUpdateManyMock).not.toHaveBeenCalled();
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
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careCaseUpdateManyMock).not.toHaveBeenCalled();
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
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careCaseUpdateManyMock).not.toHaveBeenCalled();
  });

  it('denies unassigned case PATCH before reference validation or updates', async () => {
    txCareCaseFindFirstMock.mockReset().mockResolvedValue(null);

    const response = (await PATCH(
      createPatchRequest({
        primary_pharmacist_id: 'user_1',
      }),
      {
        params: Promise.resolve({ id: 'case_2' }),
      },
    ))!;

    expect(response.status).toBe(404);
    expect(withOrgContextMock).toHaveBeenCalled();
    expect(careCaseUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects an inactive membership inside the write transaction', async () => {
    membershipFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(createPatchRequest({ notes: 'updated' }), {
      params: Promise.resolve({ id: 'case_1' }),
    }))!;

    expect(response.status).toBe(403);
    expect(txCareCaseFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseUpdateManyMock).not.toHaveBeenCalled();
    expect(writePatientFieldRevisionsMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when the case update transaction fails unexpectedly', async () => {
    membershipFindFirstMock.mockRejectedValueOnce(
      new Error('患者 山田花子 東京都千代田区1-1-1 raw case update failure'),
    );

    const response = (await PATCH(createPatchRequest({ notes: 'updated' }), {
      params: Promise.resolve({ id: 'case_1' }),
    }))!;

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(response.headers.get('X-Correlation-Id')).toBe('case_patch_test');
    const body = await response.json();
    expect(body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田花子');
    expect(JSON.stringify(body)).not.toContain('東京都千代田区1-1-1');
    expect(careCaseUpdateManyMock).not.toHaveBeenCalled();
    expect(writePatientFieldRevisionsMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects a stale version before mutating the case', async () => {
    txCareCaseFindFirstMock.mockReset().mockResolvedValue({
      id: 'case_1',
      org_id: 'org_1',
      patient_id: 'patient_1',
      status: 'active',
      version: 4,
    });

    const response = (await PATCH(createPatchRequest({ notes: 'stale' }), {
      params: Promise.resolve({ id: 'case_1' }),
    }))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: { expected_version: 1, current_version: 4 },
    });
    expect(careCaseUpdateManyMock).not.toHaveBeenCalled();
    expect(writePatientFieldRevisionsMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects writes to a terminal case', async () => {
    txCareCaseFindFirstMock.mockReset().mockResolvedValue({
      id: 'case_1',
      org_id: 'org_1',
      patient_id: 'patient_1',
      status: 'discharged',
      version: 1,
    });

    const response = (await PATCH(createPatchRequest({ notes: 'late update' }), {
      params: Promise.resolve({ id: 'case_1' }),
    }))!;

    expect(response.status).toBe(409);
    expect(careCaseUpdateManyMock).not.toHaveBeenCalled();
    expect(writePatientFieldRevisionsMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('does not write revisions or audit data after a compare-and-swap conflict', async () => {
    careCaseUpdateManyMock.mockResolvedValue({ count: 0 });

    const response = (await PATCH(createPatchRequest({ notes: 'racing update' }), {
      params: Promise.resolve({ id: 'case_1' }),
    }))!;

    expect(response.status).toBe(409);
    expect(txCareCaseFindFirstMock).toHaveBeenCalledTimes(1);
    expect(writePatientFieldRevisionsMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
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
    expect(careCaseUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'case_1', org_id: 'org_1', status: 'active', version: 1 },
      data: expect.objectContaining({
        referral_source: null,
        start_date: null,
        end_date: null,
        end_reason: null,
        notes: null,
        version: { increment: 1 },
      }),
    });
  });
});
