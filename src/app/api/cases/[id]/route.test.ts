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

  it('rejects blank case ids before loading case details', async () => {
    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
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
      pharmacist_id: 'pharmacist_2',
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
