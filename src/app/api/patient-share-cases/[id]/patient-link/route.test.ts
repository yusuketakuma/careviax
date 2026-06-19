import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  patientShareCaseFindFirstMock,
  patientLinkUpdateManyMock,
  patientLinkFindUniqueOrThrowMock,
  patientShareCaseUpdateMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  patientShareCaseFindFirstMock: vi.fn(),
  patientLinkUpdateManyMock: vi.fn(),
  patientLinkFindUniqueOrThrowMock: vi.fn(),
  patientShareCaseUpdateMock: vi.fn(),
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

import { PATCH as rawPATCH } from './route';

const routeContext = { params: Promise.resolve({ id: 'share_case_1' }) };

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/patient-share-cases/share_case_1/patient-link', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/patient-share-cases/[id]/patient-link PATCH', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-19T00:00:00.000Z'));
    vi.clearAllMocks();
    patientShareCaseFindFirstMock.mockResolvedValue({
      id: 'share_case_1',
      status: 'draft',
      base_pharmacy_approved_by: null,
      partner_pharmacy_approved_by: null,
      patient_link: {
        id: 'patient_link_1',
        match_status: 'pending',
        approved_by_base: null,
        approved_by_partner: null,
        base_patient_snapshot: {
          name: '山田 花子',
          name_kana: 'ヤマダ ハナコ',
          birth_date: '1950-01-02',
        },
      },
    });
    patientLinkUpdateManyMock.mockResolvedValue({ count: 1 });
    patientLinkFindUniqueOrThrowMock.mockResolvedValue({
      id: 'patient_link_1',
      match_status: 'pending',
    });
    patientShareCaseUpdateMock.mockResolvedValue({
      id: 'share_case_1',
      status: 'pending_partner',
      updated_at: new Date('2026-06-19T00:00:00.000Z'),
    });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patientShareCase: {
          findFirst: patientShareCaseFindFirstMock,
          update: patientShareCaseUpdateMock,
        },
        patientLink: {
          updateMany: patientLinkUpdateManyMock,
          findUniqueOrThrow: patientLinkFindUniqueOrThrowMock,
        },
      }),
    );
  });

  it('records base approval while keeping the link pending and updating share-case approval SSOT', async () => {
    const response = await rawPATCH(createRequest({ decision: 'base_approve' }), routeContext);

    expect(response.status).toBe(200);
    expect(patientLinkUpdateManyMock).toHaveBeenCalledWith({
      where: {
        share_case_id: 'share_case_1',
        org_id: 'org_1',
        match_status: 'pending',
      },
      data: {
        approved_by_base: 'user_1',
      },
    });
    expect(patientShareCaseUpdateMock).toHaveBeenCalledWith({
      where: { id_org_id: { id: 'share_case_1', org_id: 'org_1' } },
      data: {
        status: 'pending_partner',
        base_pharmacy_approved_by: 'user_1',
        base_pharmacy_approved_at: new Date('2026-06-19T00:00:00.000Z'),
        updated_by: 'user_1',
      },
      select: { id: true, status: true, updated_at: true },
    });
  });

  it('rejects partner acceptance until base approval is present on both SSOT fields', async () => {
    const response = await rawPATCH(
      createRequest({
        decision: 'accept',
        partner_patient_id: 'partner_patient_1',
        partner_patient_snapshot: {
          name: '山田 花子',
          name_kana: 'ヤマダ ハナコ',
          birth_date: '1950-01-02',
        },
      }),
      routeContext,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      details: { blocker: 'base_approval_missing' },
    });
    expect(patientLinkUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('accepts only pending links and writes compact audit metadata without snapshots', async () => {
    patientShareCaseFindFirstMock.mockResolvedValue({
      id: 'share_case_1',
      status: 'pending_partner',
      base_pharmacy_approved_by: 'base_user',
      partner_pharmacy_approved_by: null,
      patient_link: {
        id: 'patient_link_1',
        match_status: 'pending',
        approved_by_base: 'base_user',
        approved_by_partner: null,
        base_patient_snapshot: {
          name: '山田 花子',
          name_kana: 'ヤマダ ハナコ',
          birth_date: '1950-01-02',
        },
      },
    });
    patientLinkFindUniqueOrThrowMock.mockResolvedValue({
      id: 'patient_link_1',
      match_status: 'accepted',
    });

    const response = await rawPATCH(
      createRequest({
        decision: 'accept',
        partner_patient_id: 'partner_patient_1',
        partner_patient_snapshot: {
          name: '山田 花子',
          name_kana: 'ヤマダ ハナコ',
          birth_date: '1950-01-02',
          address: '東京都港区1-2-3',
        },
      }),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(patientLinkUpdateManyMock).toHaveBeenCalledWith({
      where: {
        share_case_id: 'share_case_1',
        org_id: 'org_1',
        match_status: 'pending',
      },
      data: expect.objectContaining({
        match_status: 'accepted',
        approved_by_partner: 'user_1',
        accepted_at: new Date('2026-06-19T00:00:00.000Z'),
        partner_patient_id: 'partner_patient_1',
        partner_patient_snapshot: expect.objectContaining({
          name: '山田 花子',
          name_kana: 'ヤマダ ハナコ',
          birth_date: '1950-01-02',
          address: '東京都港区1-2-3',
          identity_proof: expect.objectContaining({
            checked_by: 'user_1',
            matched: true,
            mismatch_fields: [],
          }),
        }),
      }),
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        changes: expect.objectContaining({
          has_partner_patient_snapshot: true,
          identity_mismatch_fields: [],
          identity_override_reason_length: 0,
          decline_reason_length: 0,
        }),
      }),
    );
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('山田 花子');
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('東京都港区1-2-3');
  });

  it('rejects partner acceptance without identity proof before update or audit side effects', async () => {
    patientShareCaseFindFirstMock.mockResolvedValue({
      id: 'share_case_1',
      status: 'pending_partner',
      base_pharmacy_approved_by: 'base_user',
      partner_pharmacy_approved_by: null,
      patient_link: {
        id: 'patient_link_1',
        match_status: 'pending',
        approved_by_base: 'base_user',
        approved_by_partner: null,
        base_patient_snapshot: {
          name: '山田 花子',
          name_kana: 'ヤマダ ハナコ',
          birth_date: '1950-01-02',
        },
      },
    });

    const response = await rawPATCH(
      createRequest({
        decision: 'accept',
        partner_patient_id: 'partner_patient_1',
      }),
      routeContext,
    );

    expect(response.status).toBe(400);
    expect(patientLinkUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects mismatched partner identity without an override reason', async () => {
    patientShareCaseFindFirstMock.mockResolvedValue({
      id: 'share_case_1',
      status: 'pending_partner',
      base_pharmacy_approved_by: 'base_user',
      partner_pharmacy_approved_by: null,
      patient_link: {
        id: 'patient_link_1',
        match_status: 'pending',
        approved_by_base: 'base_user',
        approved_by_partner: null,
        base_patient_snapshot: {
          name: '山田 花子',
          name_kana: 'ヤマダ ハナコ',
          birth_date: '1950-01-02',
        },
      },
    });

    const response = await rawPATCH(
      createRequest({
        decision: 'accept',
        partner_patient_id: 'partner_patient_1',
        partner_patient_snapshot: {
          name: '別人 花子',
          name_kana: 'ベツジン ハナコ',
          birth_date: '1950-01-02',
        },
      }),
      routeContext,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      details: { blocker: 'identity_mismatch', mismatch_fields: ['name', 'name_kana'] },
    });
    expect(patientLinkUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects terminal link transitions before update or audit side effects', async () => {
    patientShareCaseFindFirstMock.mockResolvedValue({
      id: 'share_case_1',
      status: 'pending_partner',
      base_pharmacy_approved_by: 'base_user',
      partner_pharmacy_approved_by: 'partner_user',
      patient_link: {
        id: 'patient_link_1',
        match_status: 'accepted',
        approved_by_base: 'base_user',
        approved_by_partner: 'partner_user',
      },
    });

    const response = await rawPATCH(
      createRequest({ decision: 'decline', decline_reason: '別人' }),
      routeContext,
    );

    expect(response.status).toBe(409);
    expect(patientLinkUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
