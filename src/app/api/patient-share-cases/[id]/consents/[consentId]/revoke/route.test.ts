import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  authPlumbingFailureRef,
  withOrgContextMock,
  patientShareConsentFindFirstMock,
  patientShareConsentUpdateManyMock,
  patientShareConsentFindUniqueOrThrowMock,
  patientShareCaseUpdateMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  authPlumbingFailureRef: { current: null as Error | null },
  withOrgContextMock: vi.fn(),
  patientShareConsentFindFirstMock: vi.fn(),
  patientShareConsentUpdateManyMock: vi.fn(),
  patientShareConsentFindUniqueOrThrowMock: vi.fn(),
  patientShareCaseUpdateMock: vi.fn(),
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

import { POST as rawPOST } from './route';

const routeContext = {
  params: Promise.resolve({ id: 'share_case_1', consentId: 'share_consent_1' }),
};

function createRequest(body: unknown = {}) {
  return new NextRequest(
    'http://localhost/api/patient-share-cases/share_case_1/consents/share_consent_1/revoke',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

describe('/api/patient-share-cases/[id]/consents/[consentId]/revoke POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authPlumbingFailureRef.current = null;
    patientShareConsentFindFirstMock.mockResolvedValue({
      id: 'share_consent_1',
      share_case_id: 'share_case_1',
      revoked_at: null,
      revoked_by: null,
      updated_at: new Date('2026-06-19T00:00:00.000Z'),
      share_case: { id: 'share_case_1', status: 'active' },
    });
    patientShareConsentUpdateManyMock.mockResolvedValue({ count: 1 });
    patientShareConsentFindUniqueOrThrowMock.mockResolvedValue({
      id: 'share_consent_1',
      share_case_id: 'share_case_1',
      revoked_at: new Date('2026-06-19T01:00:00.000Z'),
      revoked_by: 'user_1',
      updated_at: new Date('2026-06-19T01:00:00.000Z'),
    });
    patientShareCaseUpdateMock.mockResolvedValue({ id: 'share_case_1', status: 'revoked' });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patientShareConsent: {
          findFirst: patientShareConsentFindFirstMock,
          updateMany: patientShareConsentUpdateManyMock,
          findUniqueOrThrow: patientShareConsentFindUniqueOrThrowMock,
        },
        patientShareCase: {
          update: patientShareCaseUpdateMock,
        },
      }),
    );
  });

  it('revokes the consent, revokes the active share case, and writes compact audit metadata', async () => {
    const response = await rawPOST(
      createRequest({ reason: '患者名 山田花子から撤回連絡' }),
      routeContext,
    );

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(patientShareConsentUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'share_consent_1',
        org_id: 'org_1',
        share_case_id: 'share_case_1',
        revoked_at: null,
      },
      data: { revoked_at: expect.any(Date), revoked_by: 'user_1' },
    });
    expect(patientShareCaseUpdateMock).toHaveBeenCalledWith({
      where: { id_org_id: { id: 'share_case_1', org_id: 'org_1' } },
      data: {
        status: 'revoked',
        revoked_at: expect.any(Date),
        updated_by: 'user_1',
      },
      select: { id: true, status: true },
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'patient_share_consent_revoked',
        targetType: 'PatientShareConsent',
        targetId: 'share_consent_1',
        changes: expect.objectContaining({
          share_case_id: 'share_case_1',
          share_case_status: 'revoked',
          reason_length: expect.any(Number),
        }),
      }),
    );
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('山田花子');
    await expect(response.json()).resolves.toMatchObject({
      share_case_status: 'revoked',
      already_revoked: false,
      consent: { id: 'share_consent_1', revoked_by: 'user_1' },
    });
  });

  it('returns already-revoked consent without duplicate audit or share-case writes', async () => {
    patientShareConsentFindFirstMock.mockResolvedValue({
      id: 'share_consent_1',
      share_case_id: 'share_case_1',
      revoked_at: new Date('2026-06-18T01:00:00.000Z'),
      revoked_by: 'user_2',
      updated_at: new Date('2026-06-18T01:00:00.000Z'),
      share_case: { id: 'share_case_1', status: 'revoked' },
    });

    const response = await rawPOST(createRequest(), routeContext);

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(patientShareConsentUpdateManyMock).not.toHaveBeenCalled();
    expect(patientShareCaseUpdateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      share_case_status: 'revoked',
      already_revoked: true,
      consent: { id: 'share_consent_1', revoked_by: 'user_2' },
    });
  });

  it('returns a sanitized no-store 500 when consent revocation fails unexpectedly', async () => {
    patientShareConsentUpdateManyMock.mockRejectedValueOnce(
      new Error('raw revoke failure patient 山田花子 token secret share_consent_1'),
    );

    const response = await rawPOST(
      createRequest({ reason: '患者 山田花子 token secret から撤回連絡' }),
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
    expect(serializedBody).not.toContain('raw revoke');
    expect(serializedBody).not.toContain('山田花子');
    expect(serializedBody).not.toContain('token secret');
    expect(serializedBody).not.toContain('share_consent_1');
    expect(patientShareCaseUpdateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when auth plumbing fails before body parsing', async () => {
    authPlumbingFailureRef.current = new Error(
      'raw auth revoke patient 山田花子 token secret share_consent_1',
    );

    const response = await rawPOST(createRequest({ reason: 'x'.repeat(501) }), {
      params: Promise.resolve({ id: '   ', consentId: '   ' }),
    });

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const serializedBody = JSON.stringify(body);
    expect(serializedBody).not.toContain('raw auth');
    expect(serializedBody).not.toContain('山田花子');
    expect(serializedBody).not.toContain('token secret');
    expect(serializedBody).not.toContain('share_consent_1');
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientShareConsentUpdateManyMock).not.toHaveBeenCalled();
    expect(patientShareCaseUpdateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
