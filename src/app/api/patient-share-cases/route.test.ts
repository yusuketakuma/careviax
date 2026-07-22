import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  pharmacyPartnershipFindFirstMock,
  patientFindFirstMock,
  careCaseFindFirstMock,
  managementPlanFindFirstMock,
  patientShareCaseFindManyMock,
  patientShareCaseCountMock,
  patientShareCaseGroupByMock,
  patientShareCaseCreateMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  pharmacyPartnershipFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  managementPlanFindFirstMock: vi.fn(),
  patientShareCaseFindManyMock: vi.fn(),
  patientShareCaseCountMock: vi.fn(),
  patientShareCaseGroupByMock: vi.fn(),
  patientShareCaseCreateMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (...args: unknown[]) => Promise<Response>,
    options?: { permission?: string; message?: string },
  ) => {
    return (req: NextRequest, routeContext?: unknown) => {
      const role = req.headers.get('x-role') ?? 'pharmacist';
      const canManagePatientSharing = ['owner', 'admin', 'pharmacist'].includes(role);
      const canVisit = canManagePatientSharing || role === 'pharmacist_trainee';
      const allowed =
        !options?.permission ||
        (options.permission === 'canManagePatientSharing'
          ? canManagePatientSharing
          : options.permission === 'canVisit'
            ? canVisit
            : true);
      if (!allowed) {
        return new Response(
          JSON.stringify({
            code: 'AUTH_FORBIDDEN',
            message: options?.message ?? '権限がありません',
          }),
          {
            status: 403,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      return handler(
        req,
        {
          orgId: 'org_1',
          userId: 'user_1',
          role,
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

import { GET as rawGET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);

const patientSafeRelation = {
  display_id: 'PT-0001',
  name: '山田 花子',
  name_kana: 'ヤマダ ハナコ',
  birth_date: new Date('1950-01-02T00:00:00.000Z'),
  updated_at: new Date('2026-06-18T00:00:00.000Z'),
};

function withPatientSafeRelation<T extends object>(row: T) {
  return { ...row, base_patient: patientSafeRelation };
}

function createGetRequest(query = '', role = 'pharmacist') {
  return new NextRequest(`http://localhost/api/patient-share-cases${query}`, {
    headers: { 'x-role': role },
  });
}

describe('/api/patient-share-cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pharmacyPartnershipFindFirstMock.mockResolvedValue({
      id: 'partnership_1',
      status: 'active',
      partner_pharmacy: { status: 'active' },
    });
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '山田 花子',
      name_kana: 'ヤマダ ハナコ',
      birth_date: new Date('1950-01-02T00:00:00.000Z'),
      gender: 'female',
      residences: [
        {
          address: '東京都港区1-2-3',
          facility_id: null,
          facility_unit_id: null,
          unit_name: '203',
        },
      ],
    });
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1', patient_id: 'patient_1' });
    managementPlanFindFirstMock.mockResolvedValue({
      id: 'plan_1',
      case_id: 'case_1',
      status: 'approved',
      version: 2,
      case_: { patient_id: 'patient_1' },
    });
    patientShareCaseCreateMock.mockResolvedValue({
      id: 'share_case_1',
      status: 'consent_pending',
      partnership_id: 'partnership_1',
      base_patient_id: 'patient_1',
      share_scope: {
        prescription_history: true,
        medication_profile: true,
        care_reports: true,
        attachments: false,
        print: false,
        pdf_output: true,
        download: false,
        memo: '患者名 山田 花子',
      },
      patient_link: {
        id: 'patient_link_1',
        match_status: 'pending',
        approved_by_base: null,
        approved_by_partner: null,
        accepted_at: null,
        declined_at: null,
        partner_patient_id: null,
      },
    });
    patientShareCaseFindManyMock.mockResolvedValue([
      {
        id: 'share_case_1',
        status: 'draft',
        base_patient_id: 'patient_1',
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
        partnership: {
          base_site_id: 'site_1',
          partner_pharmacy: { id: 'partner_pharmacy_1' },
        },
        patient_link: {
          id: 'patient_link_1',
          match_status: 'pending',
          approved_by_base: null,
          approved_by_partner: null,
          accepted_at: null,
          declined_at: null,
          partner_patient_id: 'partner_patient_1',
          base_patient_snapshot: { name: '山田 花子' },
          partner_patient_snapshot: { address: '東京都港区1-2-3' },
          decline_reason: '別人でした',
        },
      },
    ]);
    patientShareCaseCountMock.mockResolvedValue(1);
    patientShareCaseGroupByMock.mockResolvedValue([
      { status: 'consent_pending', _count: { _all: 1 } },
    ]);
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacyPartnership: {
          findFirst: pharmacyPartnershipFindFirstMock,
        },
        patient: {
          findFirst: patientFindFirstMock,
        },
        careCase: {
          findFirst: careCaseFindFirstMock,
        },
        managementPlan: {
          findFirst: managementPlanFindFirstMock,
        },
        patientShareCase: {
          findMany: async (...args: unknown[]) =>
            ((await patientShareCaseFindManyMock(...args)) as object[]).map(
              withPatientSafeRelation,
            ),
          count: patientShareCaseCountMock,
          groupBy: patientShareCaseGroupByMock,
          create: async (...args: unknown[]) =>
            withPatientSafeRelation((await patientShareCaseCreateMock(...args)) as object),
        },
      }),
    );
  });

  it('lists share cases without returning patient-link snapshots or decline reasons', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost/api/patient-share-cases?view_context=pharmacy_cooperation_workflow',
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(patientShareCaseCountMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1' },
    });
    expect(patientShareCaseFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          partnership: {
            select: {
              id: true,
              status: true,
              base_site_id: true,
              partner_pharmacy: { select: { id: true, name: true, status: true } },
            },
          },
          patient_link: {
            select: {
              id: true,
              match_status: true,
              approved_by_base: true,
              approved_by_partner: true,
              accepted_at: true,
              declined_at: true,
              partner_patient_id: true,
            },
          },
        }),
      }),
    );
    const body = await response.json();
    expect(body).toEqual(
      expect.objectContaining({
        data: expect.any(Array),
        meta: expect.objectContaining({
          has_more: false,
          next_cursor: null,
          returned_count: 1,
          total_count: 1,
          count_basis: 'filtered_query_exact',
          filters_applied: {
            id: null,
            status: null,
            partnership_id: null,
            base_patient_id: null,
          },
          request_cursor: null,
          status_counts: expect.objectContaining({
            consent_pending: 1,
            active: 0,
          }),
        }),
      }),
    );
    expect(body.data).toHaveLength(1);
    expect(body).not.toHaveProperty('hasMore');
    expect(body).not.toHaveProperty('nextCursor');
    expect(body).not.toHaveProperty('total_count');
    expect(body).not.toHaveProperty('visible_count');
    expect(body).not.toHaveProperty('hidden_count');
    expect(body).not.toHaveProperty('status_counts');
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('base_patient_snapshot');
    expect(bodyText).not.toContain('partner_patient_snapshot');
    expect(bodyText).not.toContain('別人でした');
    expect(body.data[0].patient_safe_display).toEqual({
      display_id: 'PT-0001',
      name: '山田 花子',
      name_kana: 'ヤマダ ハナコ',
      birth_date: '1950-01-02',
      updated_at: '2026-06-18T00:00:00.000Z',
    });
    expect(bodyText).not.toContain('東京都港区1-2-3');
    expect(bodyText).not.toContain('share_scope');
    expect(bodyText).not.toContain('memo');
    expect(bodyText).toContain('has_partner_patient_id');
    expect(bodyText).toContain('scope_keys');
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
        actorSiteId: 'site_1',
      }),
      expect.objectContaining({
        action: 'patient_share_cases_viewed',
        targetType: 'PatientShareCase',
        targetId: 'patient_share_cases',
        patientId: undefined,
        changes: expect.objectContaining({
          target_screen: 'pharmacy_cooperation_workflow',
          viewer_role: 'pharmacist',
          viewed_count: 1,
          share_case_count: 1,
          total_share_case_count: 1,
          visible_share_case_count: 1,
          returned_share_case_count: 1,
          share_case_status_counts: expect.objectContaining({
            consent_pending: 1,
            active: 0,
          }),
          base_patient_count: 1,
          base_site_count: 1,
          partner_pharmacy_count: 1,
          visible_base_patient_count: 1,
          visible_base_site_count: 1,
          visible_partner_pharmacy_count: 1,
        }),
      }),
    );
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('山田 花子');
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('東京都港区1-2-3');
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('patient_1');
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('partner_pharmacy_1');
  });

  it('returns exact workflow count metadata without exposing unreturned row details', async () => {
    patientShareCaseFindManyMock.mockResolvedValue([
      {
        id: 'share_case_1',
        status: 'active',
        base_patient_id: 'patient_1',
        share_scope: {
          prescription_history: true,
          medication_profile: true,
          care_reports: true,
          attachments: false,
          print: false,
          pdf_output: false,
          download: false,
          memo: 'hidden patient note',
        },
        partnership: {
          base_site_id: 'site_1',
          partner_pharmacy: { id: 'partner_pharmacy_1' },
        },
        patient_link: null,
      },
      {
        id: 'share_case_2',
        status: 'active',
        base_patient_id: 'patient_2',
        share_scope: {
          prescription_history: true,
          medication_profile: true,
          care_reports: true,
          attachments: false,
          print: false,
          pdf_output: false,
          download: false,
          memo: 'second hidden patient note',
        },
        partnership: {
          base_site_id: 'site_1',
          partner_pharmacy: { id: 'partner_pharmacy_2' },
        },
        patient_link: {
          id: 'patient_link_2',
          match_status: 'pending',
          approved_by_base: null,
          approved_by_partner: null,
          accepted_at: null,
          declined_at: null,
          partner_patient_id: 'partner_patient_2',
          base_patient_snapshot: { name: '患者 二郎' },
          partner_patient_snapshot: { address: '東京都新宿区9-9-9' },
          decline_reason: 'hidden decline reason',
        },
      },
      {
        id: 'share_case_hidden_cursor_probe',
        status: 'consent_pending',
        base_patient_id: 'patient_hidden',
        share_scope: { memo: 'must not be serialized' },
        partnership: {
          base_site_id: 'site_2',
          partner_pharmacy: { id: 'partner_pharmacy_hidden' },
        },
        patient_link: null,
      },
    ]);
    patientShareCaseCountMock.mockResolvedValue(12);
    patientShareCaseGroupByMock.mockResolvedValue([
      { status: 'active', _count: { _all: 5 } },
      { status: 'consent_pending', _count: { _all: 4 } },
      { status: 'partner_confirmation_pending', _count: { _all: 3 } },
    ]);

    const response = await GET(
      createGetRequest('?limit=2&view_context=pharmacy_cooperation_workflow'),
    );

    expect(response.status).toBe(200);
    expect(patientShareCaseCountMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1' },
    });
    expect(patientShareCaseGroupByMock).toHaveBeenCalledWith({
      by: ['status'],
      where: { org_id: 'org_1' },
      _count: { _all: true },
    });
    const body = await response.json();
    expect(body).toEqual(
      expect.objectContaining({
        meta: expect.objectContaining({
          has_more: true,
          next_cursor: 'share_case_2',
          returned_count: 2,
          total_count: 12,
          count_basis: 'filtered_query_exact',
          filters_applied: {
            id: null,
            status: null,
            partnership_id: null,
            base_patient_id: null,
          },
          request_cursor: null,
          status_counts: expect.objectContaining({
            active: 5,
            consent_pending: 4,
            partner_confirmation_pending: 3,
            suspended: 0,
          }),
        }),
      }),
    );
    expect(body.data).toHaveLength(2);
    expect(body).not.toHaveProperty('hasMore');
    expect(body).not.toHaveProperty('nextCursor');
    expect(body).not.toHaveProperty('total_count');
    expect(body).not.toHaveProperty('visible_count');
    expect(body).not.toHaveProperty('hidden_count');
    expect(body).not.toHaveProperty('status_counts');
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('share_case_hidden_cursor_probe');
    expect(bodyText).not.toContain('must not be serialized');
    expect(bodyText).not.toContain('患者 二郎');
    expect(bodyText).not.toContain('東京都新宿区9-9-9');
    expect(bodyText).not.toContain('hidden decline reason');
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        patientId: undefined,
        changes: expect.objectContaining({
          viewed_count: 2,
          share_case_count: 2,
          total_share_case_count: 12,
          visible_share_case_count: 2,
          returned_share_case_count: 2,
          visible_base_patient_count: 2,
          visible_base_site_count: 1,
          visible_partner_pharmacy_count: 2,
          share_case_status_counts: expect.objectContaining({
            active: 5,
            consent_pending: 4,
            partner_confirmation_pending: 3,
          }),
        }),
      }),
    );
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain(
      'partner_pharmacy_hidden',
    );
  });

  it('omits exact counts for patient-specific filters without exposing hidden row details', async () => {
    patientShareCaseFindManyMock.mockResolvedValue([
      {
        id: 'share_case_1',
        status: 'active',
        base_patient_id: 'patient_1',
        share_scope: {
          prescription_history: true,
          medication_profile: true,
          care_reports: true,
          attachments: false,
          print: false,
          pdf_output: false,
          download: false,
          memo: 'hidden patient note',
        },
        partnership: {
          base_site_id: 'site_1',
          partner_pharmacy: { id: 'partner_pharmacy_1' },
        },
        patient_link: null,
      },
      {
        id: 'share_case_2',
        status: 'active',
        base_patient_id: 'patient_2',
        share_scope: {
          prescription_history: true,
          medication_profile: true,
          care_reports: true,
          attachments: false,
          print: false,
          pdf_output: false,
          download: false,
          memo: 'second hidden patient note',
        },
        partnership: {
          base_site_id: 'site_1',
          partner_pharmacy: { id: 'partner_pharmacy_2' },
        },
        patient_link: {
          id: 'patient_link_2',
          match_status: 'pending',
          approved_by_base: null,
          approved_by_partner: null,
          accepted_at: null,
          declined_at: null,
          partner_patient_id: 'partner_patient_2',
          base_patient_snapshot: { name: '患者 二郎' },
          partner_patient_snapshot: { address: '東京都新宿区9-9-9' },
          decline_reason: 'hidden decline reason',
        },
      },
      {
        id: 'share_case_hidden_cursor_probe',
        status: 'active',
        base_patient_id: 'patient_hidden',
        share_scope: { memo: 'must not be serialized' },
        partnership: {
          base_site_id: 'site_2',
          partner_pharmacy: { id: 'partner_pharmacy_hidden' },
        },
        patient_link: null,
      },
    ]);
    patientShareCaseCountMock.mockResolvedValue(12);

    const response = await GET(
      createGetRequest('?limit=2&status=active&base_patient_id=patient_1'),
    );

    expect(response.status).toBe(200);
    expect(patientShareCaseCountMock).not.toHaveBeenCalled();
    expect(patientShareCaseGroupByMock).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body).toEqual(
      expect.objectContaining({
        meta: expect.objectContaining({
          has_more: true,
          next_cursor: 'share_case_2',
        }),
      }),
    );
    expect(body).not.toHaveProperty('total_count');
    expect(body).not.toHaveProperty('visible_count');
    expect(body).not.toHaveProperty('hidden_count');
    expect(body).not.toHaveProperty('hasMore');
    expect(body).not.toHaveProperty('nextCursor');
    expect(body.meta).not.toHaveProperty('total_count');
    expect(body.meta).not.toHaveProperty('visible_count');
    expect(body.meta).not.toHaveProperty('hidden_count');
    expect(body.data).toHaveLength(2);
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('share_case_hidden_cursor_probe');
    expect(bodyText).not.toContain('must not be serialized');
    expect(bodyText).not.toContain('患者 二郎');
    expect(bodyText).not.toContain('東京都新宿区9-9-9');
    expect(bodyText).not.toContain('hidden decline reason');
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        patientId: 'patient_1',
        changes: expect.objectContaining({
          viewed_count: 2,
          share_case_count: 2,
          visible_share_case_count: 2,
        }),
      }),
    );
    const auditChanges = createAuditLogEntryMock.mock.calls[0]?.[2]?.changes;
    expect(auditChanges).not.toHaveProperty('total_share_case_count');
    expect(auditChanges).not.toHaveProperty('hidden_share_case_count');
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain(
      'partner_pharmacy_hidden',
    );
  });

  it('keeps exact counts and request cursor metadata on continuation pages', async () => {
    patientShareCaseFindManyMock.mockResolvedValue([
      {
        id: 'share_case_page_2',
        status: 'active',
        base_patient_id: 'patient_1',
        share_scope: {
          prescription_history: true,
          medication_profile: true,
          care_reports: true,
          attachments: false,
          print: false,
          pdf_output: false,
          download: false,
        },
        partnership: {
          base_site_id: 'site_1',
          partner_pharmacy: { id: 'partner_pharmacy_1' },
        },
        patient_link: null,
      },
      {
        id: 'share_case_page_3',
        status: 'active',
        base_patient_id: 'patient_2',
        share_scope: {
          prescription_history: true,
          medication_profile: true,
          care_reports: true,
          attachments: false,
          print: false,
          pdf_output: false,
          download: false,
        },
        partnership: {
          base_site_id: 'site_1',
          partner_pharmacy: { id: 'partner_pharmacy_2' },
        },
        patient_link: null,
      },
    ]);
    patientShareCaseCountMock.mockResolvedValue(3);
    patientShareCaseGroupByMock.mockResolvedValue([{ status: 'active', _count: { _all: 3 } }]);

    const response = await GET(
      createGetRequest('?limit=1&cursor=share_case_1&view_context=pharmacy_cooperation_workflow'),
    );

    expect(response.status).toBe(200);
    expect(patientShareCaseCountMock).toHaveBeenCalledWith({ where: { org_id: 'org_1' } });
    expect(patientShareCaseGroupByMock).toHaveBeenCalledWith({
      by: ['status'],
      where: { org_id: 'org_1' },
      _count: { _all: true },
    });
    const body = await response.json();
    expect(body).toEqual(
      expect.objectContaining({
        meta: expect.objectContaining({
          has_more: true,
          next_cursor: 'share_case_page_2',
          returned_count: 1,
          total_count: 3,
          count_basis: 'filtered_query_exact',
          filters_applied: {
            id: null,
            status: null,
            partnership_id: null,
            base_patient_id: null,
          },
          request_cursor: 'share_case_1',
        }),
      }),
    );
    expect(body).not.toHaveProperty('total_count');
    expect(body).not.toHaveProperty('visible_count');
    expect(body).not.toHaveProperty('hidden_count');
    expect(body).not.toHaveProperty('hasMore');
    expect(body).not.toHaveProperty('nextCursor');
    expect(body.meta).not.toHaveProperty('visible_count');
    expect(body.meta).not.toHaveProperty('hidden_count');
    const auditChanges = createAuditLogEntryMock.mock.calls[0]?.[2]?.changes;
    expect(auditChanges).toEqual(
      expect.objectContaining({
        target_screen: 'pharmacy_cooperation_workflow',
        viewed_count: 1,
        share_case_count: 1,
        visible_share_case_count: 1,
        total_share_case_count: 3,
        returned_share_case_count: 1,
      }),
    );
    expect(auditChanges).not.toHaveProperty('hidden_share_case_count');
  });

  it('lists share cases without optional predicates when filters and view context are omitted', async () => {
    const response = await GET(createGetRequest('?limit=8'));

    expect(response.status).toBe(200);
    const where = patientShareCaseFindManyMock.mock.calls[0]?.[0]?.where;
    expect(where).toEqual(
      expect.objectContaining({
        org_id: 'org_1',
      }),
    );
    expect(where).not.toHaveProperty('status');
    expect(where).not.toHaveProperty('partnership_id');
    expect(where).not.toHaveProperty('base_patient_id');
    expect(patientShareCaseFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 9,
      }),
    );
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        patientId: undefined,
        changes: expect.objectContaining({
          target_screen: 'patient_share_cases_api',
          filters: expect.objectContaining({
            status: null,
            has_partnership_id: false,
            has_base_patient_id: false,
            limit: 8,
          }),
        }),
      }),
    );
  });

  it('rejects visit-only roles before loading or auditing share cases', async () => {
    const response = await GET(createGetRequest('?limit=8', 'pharmacist_trainee'));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: '患者共有ケースの閲覧権限がありません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientShareCaseFindManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('trims and applies valid filters and view context', async () => {
    patientShareCaseGroupByMock.mockResolvedValue([{ status: 'active', _count: { _all: 1 } }]);
    const response = await GET(
      createGetRequest(
        '?id=%20share_case_1%20&status=%20active%20&partnership_id=%20partnership_1%20&base_patient_id=%20patient_1%20&view_context=%20pharmacy_cooperation_workflow%20',
      ),
    );

    expect(response.status).toBe(200);
    const where = patientShareCaseFindManyMock.mock.calls[0]?.[0]?.where;
    expect(where).toEqual(
      expect.objectContaining({
        org_id: 'org_1',
        id: 'share_case_1',
        status: 'active',
        partnership_id: 'partnership_1',
        base_patient_id: 'patient_1',
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      meta: {
        returned_count: 1,
        total_count: 1,
        count_basis: 'filtered_query_exact',
        filters_applied: {
          id: 'share_case_1',
          status: 'active',
          partnership_id: 'partnership_1',
          base_patient_id: 'patient_1',
        },
        request_cursor: null,
        status_counts: expect.objectContaining({ active: 1 }),
      },
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        patientId: 'patient_1',
        changes: expect.objectContaining({
          target_screen: 'pharmacy_cooperation_workflow',
          filters: expect.objectContaining({
            has_direct_id: true,
            status: 'active',
            has_partnership_id: true,
            has_base_patient_id: true,
          }),
        }),
      }),
    );
  });

  it.each([
    ['?id=', 'id', '患者共有ケースIDを指定してください'],
    ['?status=', 'status', 'ステータスを指定してください'],
    ['?status=%20%20', 'status', 'ステータスを指定してください'],
    ['?partnership_id=', 'partnership_id', '薬局間連携IDを指定してください'],
    ['?base_patient_id=%20%20', 'base_patient_id', '患者IDを指定してください'],
    ['?view_context=', 'view_context', '閲覧画面を指定してください'],
  ])(
    'rejects blank query "%s" before loading or auditing share cases',
    async (query, field, message) => {
      const response = await GET(createGetRequest(query));

      expect(response.status).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '検索条件が不正です',
        details: { [field]: [message] },
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(patientShareCaseFindManyMock).not.toHaveBeenCalled();
      expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    },
  );

  it('rejects an exact share case ID combined with a continuation cursor', async () => {
    const response = await GET(createGetRequest('?id=share_case_1&cursor=share_case_8'));

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { cursor: ['患者共有ケースID検索ではカーソルを指定できません'] },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported status and view context values before loading share cases', async () => {
    const unsupportedStatusResponse = await GET(createGetRequest('?status=archived'));

    expect(unsupportedStatusResponse.status).toBe(400);
    await expect(unsupportedStatusResponse.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '検索条件が不正です',
      details: { status: ['対応していないステータスです'] },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();

    vi.clearAllMocks();

    const unsupportedViewResponse = await GET(createGetRequest('?view_context=unknown'));

    expect(unsupportedViewResponse.status).toBe(400);
    await expect(unsupportedViewResponse.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '検索条件が不正です',
      details: { view_context: ['対応していない閲覧画面です'] },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
