import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  requireAuthContextMock,
  withOrgContextMock,
  careReportFindFirstMock,
  careReportUpdateManyMock,
  pharmacistCredentialFindManyMock,
  careReportRevisionCreateMock,
  auditLogCreateMock,
  allocateDisplayIdMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  careReportFindFirstMock: vi.fn(),
  careReportUpdateManyMock: vi.fn(),
  pharmacistCredentialFindManyMock: vi.fn(),
  careReportRevisionCreateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  allocateDisplayIdMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/display-id', () => ({
  allocateDisplayId: allocateDisplayIdMock,
}));

import {
  buildFinalizedCareReportContentSnapshot,
  computeFinalizedCareReportContentHash,
} from '@/server/services/care-report-finalization';
import { POST } from './route';

const REPORT_UPDATED_AT = new Date('2026-03-30T00:10:00.000Z');
const REPORT_UPDATED_AT_ISO = REPORT_UPDATED_AT.toISOString();

function createRequest(body: unknown = { expected_updated_at: REPORT_UPDATED_AT_ISO }) {
  return new NextRequest('http://localhost/api/care-reports/report_1/finalize', {
    method: 'POST',
    headers: {
      'x-org-id': 'org_1',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function baseReport() {
  return {
    id: 'report_1',
    patient_id: 'patient_1',
    case_id: 'case_1',
    visit_record_id: 'visit_record_1',
    status: 'draft',
    content: {
      summary: '医師へ共有する本文',
      billing_context: { billing_evidence_id: 'billing_1' },
      source_provenance: { visit_record_id: 'visit_record_1' },
      warnings: ['臨床上の注意'],
      report_delivery_targets: [{ delivery_record_id: 'delivery_1' }],
    },
    updated_at: REPORT_UPDATED_AT,
    finalized_at: null,
    locked_at: null,
    voided_at: null,
    report_revision: 1,
    pdf_hash: null,
  };
}

describe('/api/care-reports/[id]/finalize POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'pharmacist_1',
        orgId: 'org_1',
        role: 'pharmacist',
      },
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        careReport: {
          findFirst: careReportFindFirstMock,
          updateMany: careReportUpdateManyMock,
        },
        pharmacistCredential: {
          findMany: pharmacistCredentialFindManyMock,
        },
        careReportRevision: {
          create: careReportRevisionCreateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
    careReportFindFirstMock.mockResolvedValueOnce(baseReport()).mockResolvedValueOnce({
      id: 'report_1',
      status: 'draft',
      finalized_at: new Date('2026-03-30T01:00:00.000Z'),
      finalized_by: 'pharmacist_1',
      locked_at: new Date('2026-03-30T01:00:00.000Z'),
      locked_by: 'pharmacist_1',
      report_revision: 1,
      content_hash: 'hash_after_update',
      updated_at: new Date('2026-03-30T01:00:00.000Z'),
      finalized_pharmacist_credential_id: 'cred_1',
      finalized_credential_type: 'licensed_pharmacist',
      finalized_credential_role_snapshot: 'pharmacist',
      finalized_credential_checked_at: new Date('2026-03-30T01:00:00.000Z'),
    });
    pharmacistCredentialFindManyMock.mockResolvedValue([
      {
        id: 'cred_1',
        certification_type: 'licensed_pharmacist',
        certification_number: 'license-secret-123',
        expiry_date: new Date('2099-01-01T00:00:00.000Z'),
      },
    ]);
    careReportUpdateManyMock.mockResolvedValue({ count: 1 });
    careReportRevisionCreateMock.mockResolvedValue({ id: 'revision_1' });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    allocateDisplayIdMock.mockResolvedValue('crev0000000001');
  });

  it('builds the finalized content snapshot from clinical fields and excludes delivery metadata only', () => {
    const snapshot = buildFinalizedCareReportContentSnapshot({
      z: 1,
      source_provenance: { visit_record_id: 'visit_record_1' },
      billing_context: { billing_evidence_id: 'billing_1' },
      warnings: ['臨床上の注意'],
      report_delivery_targets: [{ delivery_record_id: 'delivery_1' }],
    });

    expect(snapshot).toEqual({
      z: 1,
      source_provenance: { visit_record_id: 'visit_record_1' },
      billing_context: { billing_evidence_id: 'billing_1' },
      warnings: ['臨床上の注意'],
    });
    expect(computeFinalizedCareReportContentHash({ b: 2, a: 1 })).toBe(
      computeFinalizedCareReportContentHash({ a: 1, b: 2 }),
    );
  });

  it('finalizes a draft with an active same-user credential, revision snapshot, and redacted audit', async () => {
    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.anything(), {
      permission: 'canAuthorReport',
      message: '報告書の確定権限がありません',
    });
    expect(pharmacistCredentialFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          user_id: 'pharmacist_1',
        },
      }),
    );
    const expectedHash = computeFinalizedCareReportContentHash(baseReport().content);
    expect(careReportUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'report_1',
        org_id: 'org_1',
        status: 'draft',
        updated_at: REPORT_UPDATED_AT,
        finalized_at: null,
        locked_at: null,
        voided_at: null,
      },
      data: expect.objectContaining({
        finalized_by: 'pharmacist_1',
        locked_by: 'pharmacist_1',
        content_hash: expectedHash,
        finalized_pharmacist_credential_id: 'cred_1',
        finalized_credential_type: 'licensed_pharmacist',
        finalized_credential_number: 'license-secret-123',
        finalized_credential_role_snapshot: 'pharmacist',
      }),
    });
    expect(allocateDisplayIdMock).toHaveBeenCalledWith(
      expect.anything(),
      'CareReportRevision',
      'org_1',
    );
    expect(careReportRevisionCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        display_id: 'crev0000000001',
        report_id: 'report_1',
        revision_no: 1,
        content_snapshot: {
          summary: '医師へ共有する本文',
          billing_context: { billing_evidence_id: 'billing_1' },
          source_provenance: { visit_record_id: 'visit_record_1' },
          warnings: ['臨床上の注意'],
        },
        content_hash: expectedHash,
        pdf_hash: null,
        created_by: 'pharmacist_1',
      },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'care_report_finalized',
        target_type: 'care_report',
        target_id: 'report_1',
        patient_id: 'patient_1',
        changes: expect.objectContaining({
          revision_no: 1,
          content_hash: expectedHash,
          credential_id: 'cred_1',
          credential_type: 'licensed_pharmacist',
        }),
      }),
    });
    expect(JSON.stringify(auditLogCreateMock.mock.calls)).not.toContain('license-secret-123');
  });

  it('rejects stale finalize attempts without revision or audit side effects', async () => {
    careReportUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await POST(
      createRequest({ expected_updated_at: '2026-03-30T00:09:00.000Z' }),
      {
        params: Promise.resolve({ id: 'report_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(careReportRevisionCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns 409 when the actor has no active pharmacist credential', async () => {
    pharmacistCredentialFindManyMock.mockResolvedValueOnce([
      {
        id: 'cred_expired',
        certification_type: 'licensed_pharmacist',
        certification_number: 'expired-secret',
        expiry_date: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(careReportUpdateManyMock).not.toHaveBeenCalled();
    expect(careReportRevisionCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});
