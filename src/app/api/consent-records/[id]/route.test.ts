import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  consentRecordFindFirstMock,
  consentRecordFindUniqueMock,
  patientFindFirstMock,
  careCaseFindFirstMock,
  fileAssetFindFirstMock,
  txPatientFindFirstMock,
  txCareCaseFindFirstMock,
  consentRecordUpdateMock,
  withOrgContextMock,
  recordConsentRecordViewedAuditMock,
  recordConsentRecordUpdatedAuditMock,
} = vi.hoisted(() => ({
  consentRecordFindFirstMock: vi.fn(),
  consentRecordFindUniqueMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  fileAssetFindFirstMock: vi.fn(),
  txPatientFindFirstMock: vi.fn(),
  txCareCaseFindFirstMock: vi.fn(),
  consentRecordUpdateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  recordConsentRecordViewedAuditMock: vi.fn(),
  recordConsentRecordUpdatedAuditMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    consentRecord: {
      findFirst: consentRecordFindFirstMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
    fileAsset: {
      findFirst: fileAssetFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/consent-record-audit', () => ({
  recordConsentRecordViewedAudit: recordConsentRecordViewedAuditMock,
  recordConsentRecordUpdatedAudit: recordConsentRecordUpdatedAuditMock,
}));

import { GET, PATCH } from './route';

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

function createRequest(method: 'GET' | 'PATCH', body?: unknown) {
  return new NextRequest('http://localhost/api/consent-records/consent_1', {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/consent-records/consent_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{"expiry_date":',
  });
}

describe('/api/consent-records/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consentRecordFindFirstMock.mockResolvedValue({
      id: 'consent_1',
      patient_id: 'patient_1',
      case_id: null,
      consent_type: 'external_sharing',
      method: 'paper_scan',
      is_active: true,
      expiry_date: new Date('2026-12-31T00:00:00.000Z'),
      document_url: 'https://example.com/consent.pdf',
      document_file_id: null,
      template_id: 'template_1',
      template_version: 2,
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
    });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    fileAssetFindFirstMock.mockResolvedValue({ id: 'file_1' });
    txPatientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    txCareCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    consentRecordUpdateMock.mockResolvedValue({ count: 1 });
    consentRecordFindUniqueMock.mockResolvedValue({
      id: 'consent_1',
      patient_id: 'patient_1',
      case_id: null,
      consent_type: 'external_sharing',
      method: 'paper_scan',
      is_active: true,
      expiry_date: new Date('2026-12-31T00:00:00.000Z'),
      document_url: '/api/files/file_1/presigned-download?download=1',
      document_file_id: null,
      template_id: 'template_1',
      template_version: 2,
    });
    recordConsentRecordViewedAuditMock.mockResolvedValue(undefined);
    recordConsentRecordUpdatedAuditMock.mockResolvedValue(undefined);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        consentRecord: {
          updateMany: consentRecordUpdateMock,
          findUnique: consentRecordFindUniqueMock,
        },
        patient: {
          findFirst: txPatientFindFirstMock,
        },
        careCase: {
          findFirst: txCareCaseFindFirstMock,
        },
      }),
    );
  });

  it('returns a consent record by id', async () => {
    const response = (await GET(createRequest('GET'), {
      params: Promise.resolve({ id: 'consent_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      id: 'consent_1',
    });
    expect(consentRecordFindFirstMock).toHaveBeenNthCalledWith(1, {
      where: { id: 'consent_1', org_id: 'org_1' },
      select: { id: true, patient_id: true, case_id: true },
    });
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'patient_1',
        org_id: 'org_1',
      },
      select: { id: true },
    });
    expect(consentRecordFindFirstMock).toHaveBeenNthCalledWith(2, {
      where: { id: 'consent_1', org_id: 'org_1' },
    });
    expect(recordConsentRecordViewedAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        consentRecord: expect.objectContaining({
          findFirst: consentRecordFindFirstMock,
        }),
      }),
      expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
      expect.objectContaining({
        id: 'consent_1',
        patient_id: 'patient_1',
        document_url: 'https://example.com/consent.pdf',
      }),
    );
  });

  it('returns a sanitized no-store 500 when consent detail audit cannot be recorded', async () => {
    recordConsentRecordViewedAuditMock.mockRejectedValueOnce(
      new Error('raw consent detail document secret'),
    );

    const response = (await GET(createRequest('GET'), {
      params: Promise.resolve({ id: 'consent_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    expect(JSON.stringify(body)).not.toContain('document secret');
  });

  it('returns a sanitized no-store 500 when consent detail lookup fails unexpectedly', async () => {
    consentRecordFindFirstMock.mockRejectedValueOnce(
      new Error('raw consent detail patient document secret'),
    );

    const response = (await GET(createRequest('GET'), {
      params: Promise.resolve({ id: 'consent_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    expect(JSON.stringify(body)).not.toContain('patient document secret');
  });

  it('rejects blank consent record ids before loading the record on GET', async () => {
    const response = (await GET(createRequest('GET'), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '同意記録IDが不正です',
    });
    expect(consentRecordFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(consentRecordUpdateMock).not.toHaveBeenCalled();
    expect(recordConsentRecordViewedAuditMock).not.toHaveBeenCalled();
  });

  it('does not return a consent record outside the patient assignment scope', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = (await GET(createRequest('GET'), {
      params: Promise.resolve({ id: 'consent_1' }),
    }))!;

    expect(response.status).toBe(404);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '同意記録が見つかりません',
    });
    expect(consentRecordFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'consent_1', org_id: 'org_1' },
      select: { id: true, patient_id: true, case_id: true },
    });
    expect(patientFindFirstMock).toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(consentRecordUpdateMock).not.toHaveBeenCalled();
    expect(recordConsentRecordViewedAuditMock).not.toHaveBeenCalled();
  });

  it('updates expiry date and audited document url', async () => {
    const response = (await PATCH(
      createRequest('PATCH', {
        expiry_date: '2026-12-31',
        document_url: '/api/files/file_1/presigned-download?download=1',
      }),
      {
        params: Promise.resolve({ id: 'consent_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(consentRecordFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'consent_1', org_id: 'org_1' },
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        consent_type: true,
        method: true,
        is_active: true,
        expiry_date: true,
        document_url: true,
        document_file_id: true,
        template_id: true,
        template_version: true,
        updated_at: true,
      },
    });
    expect(patientFindFirstMock).toHaveBeenCalled();
    expect(txPatientFindFirstMock).toHaveBeenCalled();
    expect(consentRecordUpdateMock).toHaveBeenCalledWith({
      where: {
        id: 'consent_1',
        org_id: 'org_1',
        updated_at: new Date('2026-01-01T00:00:00.000Z'),
      },
      data: {
        expiry_date: new Date('2026-12-31'),
        document_url: '/api/files/file_1/presigned-download?download=1',
      },
    });
    expect(consentRecordFindUniqueMock).toHaveBeenCalledWith({
      where: { id: 'consent_1' },
    });
    expect(recordConsentRecordUpdatedAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        consentRecord: expect.objectContaining({
          updateMany: consentRecordUpdateMock,
          findUnique: consentRecordFindUniqueMock,
        }),
      }),
      expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
      {
        before: expect.objectContaining({
          id: 'consent_1',
          expiry_date: new Date('2026-12-31T00:00:00.000Z'),
          document_url: 'https://example.com/consent.pdf',
        }),
        after: expect.objectContaining({
          id: 'consent_1',
          document_url: '/api/files/file_1/presigned-download?download=1',
        }),
        changedFields: ['expiry_date', 'document_url'],
      },
    );
  });

  it('updates the document url from a validated consent document file id', async () => {
    consentRecordFindUniqueMock.mockResolvedValueOnce({
      id: 'consent_1',
      patient_id: 'patient_1',
      case_id: null,
      consent_type: 'external_sharing',
      method: 'paper_scan',
      is_active: true,
      expiry_date: new Date('2026-12-31T00:00:00.000Z'),
      document_url: '/api/files/file_1/presigned-download?download=1',
      document_file_id: 'file_1',
      template_id: 'template_1',
      template_version: 2,
    });

    const response = (await PATCH(
      createRequest('PATCH', {
        document_file_id: 'file_1',
      }),
      {
        params: Promise.resolve({ id: 'consent_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(fileAssetFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'file_1',
        org_id: 'org_1',
        purpose: 'consent-document',
        status: 'uploaded',
        mime_type: { in: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] },
        patient_id: 'patient_1',
      },
      select: { id: true },
    });
    expect(consentRecordUpdateMock).toHaveBeenCalledWith({
      where: {
        id: 'consent_1',
        org_id: 'org_1',
        updated_at: new Date('2026-01-01T00:00:00.000Z'),
      },
      data: {
        document_url: '/api/files/file_1/presigned-download?download=1',
        document_file_id: 'file_1',
      },
    });
    expect(recordConsentRecordUpdatedAuditMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({
        changedFields: ['document_url'],
      }),
    );
  });

  it('clears both the audited document url and file asset link', async () => {
    const response = (await PATCH(
      createRequest('PATCH', {
        document_url: null,
      }),
      {
        params: Promise.resolve({ id: 'consent_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(consentRecordUpdateMock).toHaveBeenCalledWith({
      where: {
        id: 'consent_1',
        org_id: 'org_1',
        updated_at: new Date('2026-01-01T00:00:00.000Z'),
      },
      data: {
        document_url: null,
        document_file_id: null,
      },
    });
  });

  it('does not update a consent record outside the patient assignment scope', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      createRequest('PATCH', {
        expiry_date: '2026-12-31',
      }),
      {
        params: Promise.resolve({ id: 'consent_1' }),
      },
    ))!;

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      message: '同意記録が見つかりません',
    });
    expect(consentRecordFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'consent_1', org_id: 'org_1' },
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        consent_type: true,
        method: true,
        is_active: true,
        expiry_date: true,
        document_url: true,
        document_file_id: true,
        template_id: true,
        template_version: true,
        updated_at: true,
      },
    });
    expect(patientFindFirstMock).toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(consentRecordUpdateMock).not.toHaveBeenCalled();
    expect(consentRecordFindUniqueMock).not.toHaveBeenCalled();
    expect(recordConsentRecordUpdatedAuditMock).not.toHaveBeenCalled();
  });

  it('does not update when consent assignment changes inside the transaction', async () => {
    txPatientFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      createRequest('PATCH', {
        expiry_date: '2026-12-31',
      }),
      {
        params: Promise.resolve({ id: 'consent_1' }),
      },
    ))!;

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      message: '同意記録が見つかりません',
    });
    expect(patientFindFirstMock).toHaveBeenCalled();
    expect(withOrgContextMock).toHaveBeenCalled();
    expect(txPatientFindFirstMock).toHaveBeenCalled();
    expect(consentRecordUpdateMock).not.toHaveBeenCalled();
    expect(consentRecordFindUniqueMock).not.toHaveBeenCalled();
    expect(recordConsentRecordUpdatedAuditMock).not.toHaveBeenCalled();
  });

  it('returns conflict without a stale update when the consent record changed after loading', async () => {
    consentRecordUpdateMock.mockResolvedValue({ count: 0 });

    const response = (await PATCH(
      createRequest('PATCH', {
        expiry_date: '2026-12-31',
      }),
      {
        params: Promise.resolve({ id: 'consent_1' }),
      },
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同意記録が他のユーザーによって更新されています。最新のデータを取得してください。',
    });
    expect(consentRecordUpdateMock).toHaveBeenCalledWith({
      where: {
        id: 'consent_1',
        org_id: 'org_1',
        updated_at: new Date('2026-01-01T00:00:00.000Z'),
      },
      data: {
        expiry_date: new Date('2026-12-31'),
      },
    });
    expect(consentRecordFindUniqueMock).not.toHaveBeenCalled();
    expect(recordConsentRecordUpdatedAuditMock).not.toHaveBeenCalled();
  });

  it('fails closed when consent update audit cannot be recorded', async () => {
    recordConsentRecordUpdatedAuditMock.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(
      PATCH(
        createRequest('PATCH', {
          expiry_date: '2026-12-31',
        }),
        {
          params: Promise.resolve({ id: 'consent_1' }),
        },
      ),
    ).rejects.toThrow('audit unavailable');

    expect(consentRecordUpdateMock).toHaveBeenCalled();
  });

  it('rejects external document urls before mutating the consent record', async () => {
    const response = (await PATCH(
      createRequest('PATCH', {
        document_url: 'https://example.com/consent.pdf',
      }),
      {
        params: Promise.resolve({ id: 'consent_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        document_url: ['同意書文書は監査済みファイルURLまたは document_file_id で指定してください'],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(consentRecordUpdateMock).not.toHaveBeenCalled();
    expect(consentRecordFindUniqueMock).not.toHaveBeenCalled();
    expect(recordConsentRecordUpdatedAuditMock).not.toHaveBeenCalled();
  });

  it('rejects absolute audited-looking document urls before mutating the consent record', async () => {
    const response = (await PATCH(
      createRequest('PATCH', {
        document_url: 'https://evil.example/api/files/file_1/presigned-download?download=1',
      }),
      {
        params: Promise.resolve({ id: 'consent_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        document_url: ['同意書文書は監査済みファイルURLまたは document_file_id で指定してください'],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(consentRecordUpdateMock).not.toHaveBeenCalled();
    expect(consentRecordFindUniqueMock).not.toHaveBeenCalled();
    expect(recordConsentRecordUpdatedAuditMock).not.toHaveBeenCalled();
  });

  it('rejects blank consent record ids before parsing or updating the record', async () => {
    const response = (await PATCH(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '同意記録IDが不正です',
    });
    expect(consentRecordFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(consentRecordUpdateMock).not.toHaveBeenCalled();
    expect(consentRecordFindUniqueMock).not.toHaveBeenCalled();
  });

  it('rejects non-object request bodies before loading or updating the consent record', async () => {
    const response = (await PATCH(createRequest('PATCH', ['unexpected']), {
      params: Promise.resolve({ id: 'consent_1' }),
    }))!;

    expect(response.status).toBe(400);
    expect(consentRecordFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(consentRecordUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before loading or updating the consent record', async () => {
    const response = (await PATCH(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'consent_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(consentRecordFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(consentRecordUpdateMock).not.toHaveBeenCalled();
  });
});
