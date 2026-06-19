import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  patientShareCaseFindFirstMock,
  patientShareCaseUpdateMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  patientShareCaseFindFirstMock: vi.fn(),
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

function createPatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/patient-share-cases/share_case_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/patient-share-cases/[id] PATCH', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-19T00:00:00.000Z'));
    vi.clearAllMocks();
    patientShareCaseFindFirstMock.mockResolvedValue({
      id: 'share_case_1',
      status: 'draft',
      share_scope: {
        prescription_history: true,
        medication_profile: true,
        care_reports: true,
        attachments: false,
        print: false,
        pdf_output: false,
        download: false,
        memo: '患者名 山田 花子',
      },
      consents: [],
    });
    patientShareCaseUpdateMock.mockResolvedValue({
      id: 'share_case_1',
      status: 'draft',
      updated_at: new Date('2026-06-19T00:00:00.000Z'),
      share_scope: {
        prescription_history: true,
        medication_profile: true,
        care_reports: true,
        attachments: true,
        print: false,
        pdf_output: true,
        download: false,
      },
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

  it('updates share scope with canonical keys, no-store response, and compact audit metadata', async () => {
    const response = await rawPATCH(
      createPatchRequest({
        share_scope: {
          attachments: true,
          pdf_output: true,
          print: 'yes',
          download: false,
          memo: '患者名 山田 花子',
        },
      }),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(patientShareCaseUpdateMock).toHaveBeenCalledWith({
      where: { id_org_id: { id: 'share_case_1', org_id: 'org_1' } },
      data: {
        share_scope: {
          prescription_history: true,
          medication_profile: true,
          care_reports: true,
          attachments: true,
          print: false,
          pdf_output: true,
          download: false,
        },
        updated_by: 'user_1',
      },
      select: {
        id: true,
        status: true,
        updated_at: true,
        share_scope: true,
      },
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'patient_share_case_scope_updated',
        targetType: 'PatientShareCase',
        targetId: 'share_case_1',
        changes: {
          status: 'draft',
          previous_scope_keys: ['care_reports', 'medication_profile', 'prescription_history'],
          share_scope_keys: [
            'attachments',
            'care_reports',
            'medication_profile',
            'pdf_output',
            'prescription_history',
          ],
          enabled_scope_count: 5,
          disabled_scope_count: 2,
        },
      }),
    );
    const bodyText = JSON.stringify(await response.json());
    expect(bodyText).not.toContain('share_scope');
    expect(bodyText).not.toContain('memo');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).toContain('scope_keys');
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('山田 花子');
  });

  it('rejects active share-scope expansion when no active consent covers the requested scope', async () => {
    patientShareCaseFindFirstMock.mockResolvedValue({
      id: 'share_case_1',
      status: 'active',
      share_scope: {
        prescription_history: true,
        medication_profile: true,
        care_reports: true,
        attachments: false,
        print: false,
        pdf_output: false,
        download: false,
      },
      consents: [
        {
          consent_date: new Date('2026-06-01T00:00:00.000Z'),
          valid_until: null,
          revoked_at: null,
          scope: {
            prescription_history: true,
            medication_profile: true,
            care_reports: true,
          },
        },
      ],
    });

    const response = await rawPATCH(
      createPatchRequest({
        share_scope: {
          prescription_history: true,
          medication_profile: true,
          care_reports: true,
          pdf_output: true,
        },
      }),
      routeContext,
    );

    expect(response.status).toBe(409);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toMatchObject({
      details: { blocker: 'active_consent_scope_missing' },
    });
    expect(patientShareCaseUpdateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('updates an active share case when active consent covers every enabled scope key', async () => {
    patientShareCaseFindFirstMock.mockResolvedValue({
      id: 'share_case_1',
      status: 'active',
      share_scope: {
        prescription_history: true,
        medication_profile: true,
        care_reports: true,
        attachments: false,
        print: false,
        pdf_output: false,
        download: false,
      },
      consents: [
        {
          consent_date: new Date('2026-06-01T00:00:00.000Z'),
          valid_until: new Date('2026-12-31T00:00:00.000Z'),
          revoked_at: null,
          scope: {
            prescription_history: true,
            medication_profile: true,
            care_reports: true,
            pdf_output: true,
          },
        },
      ],
    });

    const response = await rawPATCH(
      createPatchRequest({
        share_scope: {
          prescription_history: true,
          medication_profile: true,
          care_reports: true,
          pdf_output: true,
        },
      }),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(patientShareCaseUpdateMock).toHaveBeenCalled();
    expect(createAuditLogEntryMock).toHaveBeenCalled();
  });

  it('rejects terminal share cases before update or audit side effects', async () => {
    patientShareCaseFindFirstMock.mockResolvedValue({
      id: 'share_case_1',
      status: 'revoked',
      share_scope: {},
      consents: [],
    });

    const response = await rawPATCH(
      createPatchRequest({ share_scope: { pdf_output: true } }),
      routeContext,
    );

    expect(response.status).toBe(409);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(patientShareCaseUpdateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects invalid bodies before transaction side effects', async () => {
    const response = await rawPATCH(createPatchRequest({}), routeContext);

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientShareCaseUpdateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
