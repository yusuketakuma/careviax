import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authPlumbingFailureRef,
  withOrgContextMock,
  patientShareCaseFindFirstMock,
  patientShareCaseUpdateMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  authPlumbingFailureRef: { current: null as Error | null },
  withOrgContextMock: vi.fn(),
  patientShareCaseFindFirstMock: vi.fn(),
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

const routeContext = { params: Promise.resolve({ id: 'share_case_1' }) };
const ORIGINAL_TZ = process.env.TZ;

function createRequest() {
  return new NextRequest('http://localhost/api/patient-share-cases/share_case_1/activate', {
    method: 'POST',
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/patient-share-cases/[id]/activate POST', () => {
  beforeAll(() => {
    process.env.TZ = 'Asia/Tokyo';
  });

  afterAll(() => {
    if (ORIGINAL_TZ === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = ORIGINAL_TZ;
    }
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-19T00:00:00.000Z'));
    vi.clearAllMocks();
    authPlumbingFailureRef.current = null;
    patientShareCaseFindFirstMock.mockResolvedValue({
      id: 'share_case_1',
      status: 'partner_confirmation_pending',
      starts_at: new Date('2026-06-01T00:00:00.000Z'),
      ends_at: new Date('2026-06-19T00:00:00.000Z'),
      base_pharmacy_approved_by: 'base_user',
      partner_pharmacy_approved_by: 'partner_user',
      partnership: {
        id: 'partnership_1',
        status: 'active',
        effective_from: new Date('2026-06-01T00:00:00.000Z'),
        effective_to: new Date('2026-06-19T00:00:00.000Z'),
        partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
      },
      consents: [
        {
          consent_date: new Date('2026-06-01T00:00:00.000Z'),
          valid_until: new Date('2026-12-31T00:00:00.000Z'),
          revoked_at: null,
        },
      ],
      patient_link: {
        id: 'patient_link_1',
        match_status: 'accepted',
        approved_by_base: 'base_user',
        approved_by_partner: 'partner_user',
        accepted_at: new Date('2026-06-10T00:00:00.000Z'),
        declined_at: null,
        partner_patient_id: 'partner_patient_1',
        partner_patient_snapshot: {
          identity_proof: {
            checked_at: '2026-06-10T00:00:00.000Z',
            checked_by: 'partner_user',
            required_fields: ['name', 'birth_date'],
            matched: true,
          },
        },
      },
    });
    patientShareCaseUpdateMock.mockResolvedValue({
      id: 'share_case_1',
      status: 'active',
      consent_verified_at: new Date('2026-06-19T00:00:00.000Z'),
      activated_at: new Date('2026-06-19T00:00:00.000Z'),
      updated_at: new Date('2026-06-19T00:00:00.000Z'),
    });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patientShareCase: {
          findFirst: patientShareCaseFindFirstMock,
          update: patientShareCaseUpdateMock,
        },
      }),
    );
  });

  it('rejects activation without active consent before update or audit side effects', async () => {
    patientShareCaseFindFirstMock.mockResolvedValue({
      id: 'share_case_1',
      status: 'partner_confirmation_pending',
      starts_at: new Date('2026-06-01T00:00:00.000Z'),
      ends_at: new Date('2026-12-31T00:00:00.000Z'),
      base_pharmacy_approved_by: 'base_user',
      partner_pharmacy_approved_by: 'partner_user',
      partnership: {
        status: 'active',
        effective_from: new Date('2026-06-01T00:00:00.000Z'),
        effective_to: new Date('2026-12-31T00:00:00.000Z'),
        partner_pharmacy: { status: 'active' },
      },
      consents: [],
      patient_link: {
        match_status: 'accepted',
        approved_by_base: 'base_user',
        approved_by_partner: 'partner_user',
        accepted_at: new Date('2026-06-10T00:00:00.000Z'),
        partner_patient_snapshot: {
          identity_proof: {
            checked_at: '2026-06-10T00:00:00.000Z',
            checked_by: 'partner_user',
            required_fields: ['name', 'birth_date'],
            matched: true,
          },
        },
      },
    });

    const response = await rawPOST(createRequest(), routeContext);

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: { blocker: 'missing_active_consent' },
    });
    expect(patientShareCaseUpdateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects activation when share-case and patient-link approvals drift', async () => {
    patientShareCaseFindFirstMock.mockResolvedValue({
      id: 'share_case_1',
      status: 'partner_confirmation_pending',
      starts_at: new Date('2026-06-01T00:00:00.000Z'),
      ends_at: new Date('2026-12-31T00:00:00.000Z'),
      base_pharmacy_approved_by: 'base_user',
      partner_pharmacy_approved_by: 'partner_user_other',
      partnership: {
        status: 'active',
        effective_from: new Date('2026-06-01T00:00:00.000Z'),
        effective_to: new Date('2026-12-31T00:00:00.000Z'),
        partner_pharmacy: { status: 'active' },
      },
      consents: [
        {
          consent_date: new Date('2026-06-01T00:00:00.000Z'),
          valid_until: new Date('2026-12-31T00:00:00.000Z'),
          revoked_at: null,
        },
      ],
      patient_link: {
        match_status: 'accepted',
        approved_by_base: 'base_user',
        approved_by_partner: 'partner_user',
        accepted_at: new Date('2026-06-10T00:00:00.000Z'),
        partner_patient_snapshot: {
          identity_proof: {
            checked_at: '2026-06-10T00:00:00.000Z',
            checked_by: 'partner_user',
            required_fields: ['name', 'birth_date'],
            matched: true,
          },
        },
      },
    });

    const response = await rawPOST(createRequest(), routeContext);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      details: { blocker: 'approval_mismatch' },
    });
    expect(patientShareCaseUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects activation for inactive partner pharmacies before update or audit side effects', async () => {
    patientShareCaseFindFirstMock.mockResolvedValue({
      id: 'share_case_1',
      status: 'partner_confirmation_pending',
      starts_at: new Date('2026-06-01T00:00:00.000Z'),
      ends_at: new Date('2026-12-31T00:00:00.000Z'),
      base_pharmacy_approved_by: 'base_user',
      partner_pharmacy_approved_by: 'partner_user',
      partnership: {
        status: 'active',
        effective_from: new Date('2026-06-01T00:00:00.000Z'),
        effective_to: new Date('2026-12-31T00:00:00.000Z'),
        partner_pharmacy: { status: 'inactive' },
      },
      consents: [
        {
          consent_date: new Date('2026-06-01T00:00:00.000Z'),
          valid_until: new Date('2026-12-31T00:00:00.000Z'),
          revoked_at: null,
        },
      ],
      patient_link: {
        match_status: 'accepted',
        approved_by_base: 'base_user',
        approved_by_partner: 'partner_user',
        accepted_at: new Date('2026-06-10T00:00:00.000Z'),
        partner_patient_snapshot: {
          identity_proof: {
            checked_at: '2026-06-10T00:00:00.000Z',
            checked_by: 'partner_user',
            required_fields: ['name', 'birth_date'],
            matched: true,
          },
        },
      },
    });

    const response = await rawPOST(createRequest(), routeContext);

    expect(response.status).toBe(409);
    expect(patientShareCaseUpdateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects activation without partner identity proof before update or audit side effects', async () => {
    patientShareCaseFindFirstMock.mockResolvedValue({
      id: 'share_case_1',
      status: 'partner_confirmation_pending',
      starts_at: new Date('2026-06-01T00:00:00.000Z'),
      ends_at: new Date('2026-12-31T00:00:00.000Z'),
      base_pharmacy_approved_by: 'base_user',
      partner_pharmacy_approved_by: 'partner_user',
      partnership: {
        status: 'active',
        effective_from: new Date('2026-06-01T00:00:00.000Z'),
        effective_to: new Date('2026-12-31T00:00:00.000Z'),
        partner_pharmacy: { status: 'active' },
      },
      consents: [
        {
          consent_date: new Date('2026-06-01T00:00:00.000Z'),
          valid_until: new Date('2026-12-31T00:00:00.000Z'),
          revoked_at: null,
        },
      ],
      patient_link: {
        match_status: 'accepted',
        approved_by_base: 'base_user',
        approved_by_partner: 'partner_user',
        accepted_at: new Date('2026-06-10T00:00:00.000Z'),
        partner_patient_snapshot: null,
      },
    });

    const response = await rawPOST(createRequest(), routeContext);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      details: { blocker: 'patient_link_identity_proof_missing' },
    });
    expect(patientShareCaseUpdateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('treats same-day @db.Date share and partnership end dates as valid through the day', async () => {
    vi.setSystemTime(new Date('2026-06-19T12:00:00.000Z'));

    const response = await rawPOST(createRequest(), routeContext);

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(patientShareCaseUpdateMock).toHaveBeenCalled();
  });

  it('treats same local-day @db.Date start dates as valid during JST morning', async () => {
    vi.setSystemTime(new Date('2026-06-20T08:00:00+09:00'));
    patientShareCaseFindFirstMock.mockResolvedValue({
      id: 'share_case_1',
      status: 'partner_confirmation_pending',
      starts_at: new Date('2026-06-20T00:00:00.000Z'),
      ends_at: new Date('2026-06-20T00:00:00.000Z'),
      base_pharmacy_approved_by: 'base_user',
      partner_pharmacy_approved_by: 'partner_user',
      partnership: {
        id: 'partnership_1',
        status: 'active',
        effective_from: new Date('2026-06-20T00:00:00.000Z'),
        effective_to: new Date('2026-06-20T00:00:00.000Z'),
        partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
      },
      consents: [
        {
          consent_date: new Date('2026-06-20T00:00:00.000Z'),
          valid_until: new Date('2026-12-31T00:00:00.000Z'),
          revoked_at: null,
        },
      ],
      patient_link: {
        id: 'patient_link_1',
        match_status: 'accepted',
        approved_by_base: 'base_user',
        approved_by_partner: 'partner_user',
        accepted_at: new Date('2026-06-20T00:00:00.000Z'),
        declined_at: null,
        partner_patient_id: 'partner_patient_1',
        partner_patient_snapshot: {
          identity_proof: {
            checked_at: '2026-06-20T00:00:00.000Z',
            checked_by: 'partner_user',
            required_fields: ['name', 'birth_date'],
            matched: true,
          },
        },
      },
    });

    const response = await rawPOST(createRequest(), routeContext);

    expect(response.status).toBe(200);
    expect(patientShareCaseUpdateMock).toHaveBeenCalled();
  });

  it('activates a share case only after consent, accepted link, and both approvals', async () => {
    const response = await rawPOST(createRequest(), routeContext);

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(patientShareCaseFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'share_case_1', org_id: 'org_1' },
      select: expect.any(Object),
    });
    expect(patientShareCaseUpdateMock).toHaveBeenCalledWith({
      where: { id_org_id: { id: 'share_case_1', org_id: 'org_1' } },
      data: {
        status: 'active',
        consent_verified_at: new Date('2026-06-19T00:00:00.000Z'),
        activated_at: new Date('2026-06-19T00:00:00.000Z'),
        updated_by: 'user_1',
      },
      select: {
        id: true,
        status: true,
        consent_verified_at: true,
        activated_at: true,
        updated_at: true,
      },
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      {
        action: 'patient_share_case_activated',
        targetType: 'PatientShareCase',
        targetId: 'share_case_1',
        changes: {
          status: 'active',
          consent_verified_at: '2026-06-19T00:00:00.000Z',
        },
      },
    );
    const bodyText = JSON.stringify(await response.json());
    expect(bodyText).toContain('has_partner_patient_id');
    expect(bodyText).not.toContain('partner_patient_snapshot');
    expect(bodyText).not.toContain('identity_proof');
  });

  it('returns a sanitized no-store 500 when activation update fails unexpectedly', async () => {
    patientShareCaseUpdateMock.mockRejectedValueOnce(
      new Error('raw patient_share_case activation patient 山田太郎 token secret identity_proof'),
    );

    const response = await rawPOST(createRequest(), routeContext);

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const serializedBody = JSON.stringify(body);
    expect(serializedBody).not.toContain('patient_share_case');
    expect(serializedBody).not.toContain('山田太郎');
    expect(serializedBody).not.toContain('token secret');
    expect(serializedBody).not.toContain('identity_proof');
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when auth plumbing fails before route params', async () => {
    authPlumbingFailureRef.current = new Error(
      'raw auth patient_share_case activation patient 山田太郎 token secret',
    );

    const response = await rawPOST(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
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
    expect(serializedBody).not.toContain('patient_share_case');
    expect(serializedBody).not.toContain('山田太郎');
    expect(serializedBody).not.toContain('token secret');
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientShareCaseUpdateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
