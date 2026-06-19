import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  patientShareCaseFindFirstMock,
  patientShareConsentFindManyMock,
  patientShareConsentCreateMock,
  consentRecordFindFirstMock,
  fileAssetFindFirstMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  patientShareCaseFindFirstMock: vi.fn(),
  patientShareConsentFindManyMock: vi.fn(),
  patientShareConsentCreateMock: vi.fn(),
  consentRecordFindFirstMock: vi.fn(),
  fileAssetFindFirstMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => Promise<Response>) => {
    return (req: NextRequest, routeContext?: unknown) =>
      handler(
        req,
        {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        },
        routeContext,
      );
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

describe('/api/patient-share-cases/[id]/consents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientShareCaseFindFirstMock.mockResolvedValue({
      id: 'share_case_1',
      status: 'draft',
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
    consentRecordFindFirstMock.mockResolvedValue({ id: 'consent_record_1' });
    fileAssetFindFirstMock.mockResolvedValue({ id: 'file_1' });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patientShareCase: { findFirst: patientShareCaseFindFirstMock },
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
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
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
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
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
        status: 'uploaded',
        OR: [{ patient_id: null }, { patient_id: 'patient_1' }],
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
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'patient_share_consent_registered',
        changes: expect.objectContaining({
          consent_person_length: expect.any(Number),
          has_file_asset: true,
          has_consent_record: true,
        }),
      }),
    );
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('山田花子');
    expect(JSON.stringify(await response.json())).not.toContain('山田花子');
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
    expect(patientShareConsentCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
