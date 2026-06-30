import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authPlumbingFailureRef,
  withOrgContextMock,
  patientShareCaseFindFirstMock,
  patientShareConsentFindManyMock,
  patientShareConsentCreateMock,
  patientShareCaseUpdateMock,
  consentRecordFindFirstMock,
  fileAssetFindFirstMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  authPlumbingFailureRef: { current: null as Error | null },
  withOrgContextMock: vi.fn(),
  patientShareCaseFindFirstMock: vi.fn(),
  patientShareConsentFindManyMock: vi.fn(),
  patientShareConsentCreateMock: vi.fn(),
  patientShareCaseUpdateMock: vi.fn(),
  consentRecordFindFirstMock: vi.fn(),
  fileAssetFindFirstMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => Promise<Response>) => {
    return (req: NextRequest, routeContext?: unknown) => {
      if (authPlumbingFailureRef.current) {
        throw authPlumbingFailureRef.current;
      }

      return handler(
        req,
        {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
          actorSiteId: 'site_1',
        },
        routeContext,
      );
    };
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

import { GET as rawGET, POST as rawPOST } from './route';

const routeContext = { params: Promise.resolve({ id: 'share_case_1' }) };

function createGetRequest(url = 'http://localhost/api/patient-share-cases/share_case_1/consents') {
  return new NextRequest(url, { method: 'GET' });
}

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/patient-share-cases/share_case_1/consents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/patient-share-cases/[id]/consents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authPlumbingFailureRef.current = null;
    patientShareCaseFindFirstMock.mockResolvedValue({
      id: 'share_case_1',
      status: 'consent_pending',
      base_patient_id: 'patient_1',
    });
    patientShareConsentFindManyMock.mockResolvedValue([
      {
        id: 'share_consent_1',
        share_case_id: 'share_case_1',
        consent_record_id: 'consent_record_1',
        consent_date: new Date('2026-06-19T00:00:00.000Z'),
        consent_method: 'paper_scan',
        scope: { pdf_output: true, attachments: false },
        file_asset_id: 'file_1',
        valid_until: null,
        revoked_at: null,
        revoked_by: null,
        created_by: 'user_1',
        created_at: new Date('2026-06-19T01:00:00.000Z'),
        updated_at: new Date('2026-06-19T01:00:00.000Z'),
        consent_person: '患者家族 山田花子',
      },
    ]);
    patientShareConsentCreateMock.mockResolvedValue({
      id: 'share_consent_1',
      share_case_id: 'share_case_1',
      consent_record_id: 'consent_record_1',
      consent_date: new Date('2026-06-19T00:00:00.000Z'),
      consent_method: 'paper_scan',
      scope: { pdf_output: true },
      file_asset_id: 'file_1',
      valid_until: null,
      revoked_at: null,
      revoked_by: null,
      created_by: 'user_1',
      created_at: new Date('2026-06-19T01:00:00.000Z'),
      updated_at: new Date('2026-06-19T01:00:00.000Z'),
      consent_person: '患者家族 山田花子',
    });
    patientShareCaseUpdateMock.mockResolvedValue({ id: 'share_case_1' });
    consentRecordFindFirstMock.mockResolvedValue({ id: 'consent_record_1' });
    fileAssetFindFirstMock.mockResolvedValue({ id: 'file_1' });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patientShareCase: {
          findFirst: patientShareCaseFindFirstMock,
          update: patientShareCaseUpdateMock,
        },
        patientShareConsent: {
          findMany: patientShareConsentFindManyMock,
          create: patientShareConsentCreateMock,
        },
        consentRecord: { findFirst: consentRecordFindFirstMock },
        fileAsset: { findFirst: fileAssetFindFirstMock },
      }),
    );
  });

  it('lists safe consent metadata with no-store headers and without raw consent person', async () => {
    const response = await rawGET(createGetRequest(), routeContext);

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(patientShareConsentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { org_id: 'org_1', share_case_id: 'share_case_1' },
      }),
    );
    const text = JSON.stringify(await response.json());
    expect(text).toContain('scope_keys');
    expect(text).toContain('has_file_asset');
    expect(text).not.toContain('山田花子');
    expect(text).not.toContain('consent_person');
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
        actorSiteId: 'site_1',
      }),
      expect.objectContaining({
        action: 'patient_share_consents_viewed',
        targetType: 'PatientShareConsent',
        targetId: 'share_case_1',
        patientId: 'patient_1',
        changes: expect.objectContaining({
          target_screen: 'patient_share_case_consents',
          share_case_id: 'share_case_1',
          viewed_count: 1,
          consent_ids: ['share_consent_1'],
          consent_record_count: 1,
          file_asset_count: 1,
          revoked_count: 0,
          has_cursor: false,
          has_more: false,
        }),
      }),
    );
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('山田花子');
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('consent_person');
  });

  it('fails closed when patient share consent list audit cannot be recorded', async () => {
    createAuditLogEntryMock.mockRejectedValueOnce(
      new Error('audit unavailable patient 山田花子 token secret consent_person'),
    );

    const response = await rawGET(createGetRequest(), routeContext);

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const serializedBody = JSON.stringify(body);
    expect(serializedBody).not.toContain('audit unavailable');
    expect(serializedBody).not.toContain('山田花子');
    expect(serializedBody).not.toContain('token secret');
    expect(serializedBody).not.toContain('consent_person');
  });

  it('does not audit missing patient share consent lists', async () => {
    patientShareCaseFindFirstMock.mockResolvedValueOnce(null);

    const response = await rawGET(createGetRequest(), routeContext);

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(patientShareConsentFindManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('creates a consent after validating linked consent record and file asset without raw audit text', async () => {
    const response = await rawPOST(
      createPostRequest({
        consent_date: '2026-06-19',
        consent_person: '患者家族 山田花子',
        consent_method: 'paper_scan',
        scope: { pdf_output: true },
        consent_record_id: 'consent_record_1',
        file_asset_id: 'file_1',
      }),
      routeContext,
    );

    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(consentRecordFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'consent_record_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        revoked_date: null,
        is_active: true,
      },
      select: { id: true },
    });
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
    expect(patientShareConsentCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        share_case_id: 'share_case_1',
        consent_record_id: 'consent_record_1',
        consent_method: 'paper_scan',
        file_asset_id: 'file_1',
        created_by: 'user_1',
      }),
    });
    expect(patientShareCaseUpdateMock).toHaveBeenCalledWith({
      where: { id_org_id: { id: 'share_case_1', org_id: 'org_1' } },
      data: {
        status: 'partner_confirmation_pending',
        updated_by: 'user_1',
      },
      select: { id: true },
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1', actorSiteId: 'site_1' }),
      expect.objectContaining({
        action: 'patient_share_consent_registered',
        targetType: 'PatientShareConsent',
        targetId: 'share_consent_1',
        patientId: 'patient_1',
        changes: expect.objectContaining({
          share_case_status_before: 'consent_pending',
          share_case_status_after: 'partner_confirmation_pending',
          consent_person_length: expect.any(Number),
          has_file_asset: true,
          has_consent_record: true,
        }),
      }),
    );
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('山田花子');
    expect(JSON.stringify(await response.json())).not.toContain('山田花子');
  });

  it('returns a sanitized no-store 500 when consent creation fails unexpectedly', async () => {
    patientShareConsentCreateMock.mockRejectedValueOnce(
      new Error('raw consent_create patient 山田花子 file key token secret consent_person'),
    );

    const response = await rawPOST(
      createPostRequest({
        consent_date: '2026-06-19',
        consent_person: '患者家族 山田花子',
        consent_method: 'paper_scan',
        scope: { pdf_output: true },
      }),
      routeContext,
    );

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const serializedBody = JSON.stringify(body);
    expect(serializedBody).not.toContain('consent_create');
    expect(serializedBody).not.toContain('山田花子');
    expect(serializedBody).not.toContain('file key');
    expect(serializedBody).not.toContain('token secret');
    expect(serializedBody).not.toContain('consent_person');
    expect(patientShareCaseUpdateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when auth plumbing fails before POST body parsing', async () => {
    authPlumbingFailureRef.current = new Error(
      'raw auth consent_register patient 山田花子 token secret',
    );

    const response = await rawPOST(
      createPostRequest({
        consent_date: 'not-a-date',
      }),
      { params: Promise.resolve({ id: '   ' }) },
    );

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const serializedBody = JSON.stringify(body);
    expect(serializedBody).not.toContain('raw auth');
    expect(serializedBody).not.toContain('consent_register');
    expect(serializedBody).not.toContain('山田花子');
    expect(serializedBody).not.toContain('token secret');
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientShareConsentCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects file assets that are not uploaded and org-scoped to the patient share case', async () => {
    fileAssetFindFirstMock.mockResolvedValue(null);

    const response = await rawPOST(
      createPostRequest({
        consent_date: '2026-06-19',
        consent_person: '患者家族',
        consent_method: 'paper_scan',
        file_asset_id: 'foreign_file',
      }),
      routeContext,
    );

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(patientShareConsentCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects declined share cases before create or audit side effects', async () => {
    patientShareCaseFindFirstMock.mockResolvedValueOnce({
      id: 'share_case_1',
      status: 'declined',
      base_patient_id: 'patient_1',
    });

    const response = await rawPOST(
      createPostRequest({
        consent_date: '2026-06-19',
        consent_person: '患者家族',
        consent_method: 'paper_scan',
      }),
      routeContext,
    );

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(patientShareConsentCreateMock).not.toHaveBeenCalled();
    expect(patientShareCaseUpdateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
