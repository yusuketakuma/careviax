import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  pharmacyPartnershipFindFirstMock,
  patientFindFirstMock,
  careCaseFindFirstMock,
  managementPlanFindFirstMock,
  patientShareCaseFindManyMock,
  patientShareCaseCreateMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  pharmacyPartnershipFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  managementPlanFindFirstMock: vi.fn(),
  patientShareCaseFindManyMock: vi.fn(),
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

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/patient-share-cases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
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
          findMany: patientShareCaseFindManyMock,
          create: patientShareCaseCreateMock,
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
    const bodyText = JSON.stringify(await response.json());
    expect(bodyText).not.toContain('base_patient_snapshot');
    expect(bodyText).not.toContain('partner_patient_snapshot');
    expect(bodyText).not.toContain('別人でした');
    expect(bodyText).not.toContain('山田 花子');
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
          base_patient_count: 1,
          base_site_count: 1,
          partner_pharmacy_count: 1,
        }),
      }),
    );
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('山田 花子');
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('東京都港区1-2-3');
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('patient_1');
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('partner_pharmacy_1');
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
    const response = await GET(
      createGetRequest(
        '?status=%20active%20&partnership_id=%20partnership_1%20&base_patient_id=%20patient_1%20&view_context=%20pharmacy_cooperation_workflow%20',
      ),
    );

    expect(response.status).toBe(200);
    const where = patientShareCaseFindManyMock.mock.calls[0]?.[0]?.where;
    expect(where).toEqual(
      expect.objectContaining({
        org_id: 'org_1',
        status: 'active',
        partnership_id: 'partnership_1',
        base_patient_id: 'patient_1',
      }),
    );
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        patientId: 'patient_1',
        changes: expect.objectContaining({
          target_screen: 'pharmacy_cooperation_workflow',
          filters: expect.objectContaining({
            status: 'active',
            has_partnership_id: true,
            has_base_patient_id: true,
          }),
        }),
      }),
    );
  });

  it.each([
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

  it('creates a consent-pending share case with a pending patient link and patient snapshot', async () => {
    const response = await POST(
      createPostRequest({
        partnership_id: ' partnership_1 ',
        base_patient_id: ' patient_1 ',
        base_case_id: ' case_1 ',
        starts_at: '2026-06-01',
        ends_at: '2026-12-31',
        shared_management_plan_id: 'plan_1',
        shared_management_plan_version: 2,
        share_scope: {
          medication_profile: true,
          care_reports: true,
          pdf_output: true,
          memo: '患者名 山田 花子',
          download: false,
        },
      }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(patientShareCaseCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        partnership_id: 'partnership_1',
        base_patient_id: 'patient_1',
        base_case_id: 'case_1',
        status: 'consent_pending',
        starts_at: new Date('2026-06-01T00:00:00.000Z'),
        ends_at: new Date('2026-12-31T00:00:00.000Z'),
        shared_management_plan_id: 'plan_1',
        shared_management_plan_version: 2,
        share_scope: {
          prescription_history: true,
          medication_profile: true,
          care_reports: true,
          attachments: false,
          print: false,
          pdf_output: true,
          download: false,
        },
        created_by: 'user_1',
        updated_by: 'user_1',
        patient_link: {
          create: expect.objectContaining({
            base_patient_id: 'patient_1',
            match_status: 'pending',
            base_patient_snapshot: expect.objectContaining({
              id: 'patient_1',
              name: '山田 花子',
              birth_date: '1950-01-02',
              primary_residence: expect.objectContaining({
                address: '東京都港区1-2-3',
              }),
            }),
          }),
        },
      }),
      include: expect.any(Object),
    });
    const createdPatientLink =
      patientShareCaseCreateMock.mock.calls[0]?.[0]?.data?.patient_link?.create;
    expect(createdPatientLink).not.toHaveProperty('org_id');
    expect(managementPlanFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'plan_1',
        org_id: 'org_1',
      },
      select: {
        id: true,
        case_id: true,
        status: true,
        version: true,
        case_: { select: { patient_id: true } },
      },
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1', actorSiteId: 'site_1' }),
      expect.objectContaining({
        action: 'patient_share_case_created',
        targetType: 'PatientShareCase',
        targetId: 'share_case_1',
        patientId: 'patient_1',
        changes: {
          partnership_id: 'partnership_1',
          base_patient_id: 'patient_1',
          base_case_id: 'case_1',
          status: 'consent_pending',
          share_scope_keys: [
            'care_reports',
            'medication_profile',
            'pdf_output',
            'prescription_history',
          ],
          starts_at: '2026-06-01',
          ends_at: '2026-12-31',
          shared_management_plan_id: 'plan_1',
          shared_management_plan_version: 2,
        },
      }),
    );
    const bodyText = JSON.stringify(await response.json());
    expect(bodyText).not.toContain('base_patient_snapshot');
    expect(bodyText).not.toContain('partner_patient_snapshot');
    expect(bodyText).not.toContain('share_scope');
    expect(bodyText).not.toContain('memo');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).not.toContain('東京都港区1-2-3');
    expect(bodyText).toContain('scope_keys');
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('山田 花子');
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('東京都港区1-2-3');
  });

  it('serializes transaction lookups before creating a share case', async () => {
    const events: string[] = [];
    let activeLookups = 0;
    let maxActiveLookups = 0;
    const serializedLookup = <T>(label: string, value: T) => {
      events.push(`${label}:start`);
      activeLookups += 1;
      maxActiveLookups = Math.max(maxActiveLookups, activeLookups);
      return new Promise<T>((resolve) => {
        setTimeout(() => {
          activeLookups -= 1;
          events.push(`${label}:finish`);
          resolve(value);
        }, 0);
      });
    };

    pharmacyPartnershipFindFirstMock.mockImplementation(() =>
      serializedLookup('partnership', {
        id: 'partnership_1',
        status: 'active',
        partner_pharmacy: { status: 'active' },
      }),
    );
    patientFindFirstMock.mockImplementation(() =>
      serializedLookup('patient', {
        id: 'patient_1',
        name: '山田 花子',
        name_kana: 'ヤマダ ハナコ',
        birth_date: new Date('1950-01-02T00:00:00.000Z'),
        gender: 'female',
        residences: [],
      }),
    );
    careCaseFindFirstMock.mockImplementation(() =>
      serializedLookup('careCase', { id: 'case_1', patient_id: 'patient_1' }),
    );

    const response = await POST(
      createPostRequest({
        partnership_id: 'partnership_1',
        base_patient_id: 'patient_1',
        base_case_id: 'case_1',
      }),
    );

    expect(response.status).toBe(201);
    expect(maxActiveLookups).toBe(1);
    expect(events).toEqual([
      'partnership:start',
      'partnership:finish',
      'patient:start',
      'patient:finish',
      'careCase:start',
      'careCase:finish',
    ]);
  });

  it('creates a consent-pending share case without a care case lookup when base_case_id is omitted', async () => {
    const response = await POST(
      createPostRequest({
        partnership_id: 'partnership_1',
        base_patient_id: 'patient_1',
      }),
    );

    expect(response.status).toBe(201);
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(patientShareCaseCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          base_case_id: undefined,
          share_scope: {
            prescription_history: true,
            medication_profile: true,
            care_reports: true,
            attachments: false,
            print: false,
            pdf_output: false,
            download: false,
          },
        }),
      }),
    );
  });

  it('rejects invalid date windows before transaction side effects', async () => {
    const response = await POST(
      createPostRequest({
        partnership_id: 'partnership_1',
        base_patient_id: 'patient_1',
        starts_at: '2026-06-10',
        ends_at: '2026-06-09',
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientShareCaseCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it.each([
    ['draft partnership', { status: 'draft', partnerStatus: 'active' }],
    ['suspended partnership', { status: 'suspended', partnerStatus: 'active' }],
    ['ended partnership', { status: 'ended', partnerStatus: 'active' }],
    ['inactive partner pharmacy', { status: 'active', partnerStatus: 'inactive' }],
    ['archived partner pharmacy', { status: 'active', partnerStatus: 'archived' }],
  ])('rejects %s before create or audit side effects', async (_label, setup) => {
    pharmacyPartnershipFindFirstMock.mockResolvedValue({
      id: 'partnership_1',
      status: setup.status,
      partner_pharmacy: { status: setup.partnerStatus },
    });

    const response = await POST(
      createPostRequest({
        partnership_id: 'partnership_1',
        base_patient_id: 'patient_1',
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(patientShareCaseCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects a care case that belongs to another patient before create or audit side effects', async () => {
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1', patient_id: 'patient_other' });

    const response = await POST(
      createPostRequest({
        partnership_id: 'partnership_1',
        base_patient_id: 'patient_1',
        base_case_id: 'case_1',
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(patientShareCaseCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'missing management plan version',
      {
        partnership_id: 'partnership_1',
        base_patient_id: 'patient_1',
        base_case_id: 'case_1',
        shared_management_plan_id: 'plan_1',
      },
    ],
    [
      'missing management plan id',
      {
        partnership_id: 'partnership_1',
        base_patient_id: 'patient_1',
        base_case_id: 'case_1',
        shared_management_plan_version: 2,
      },
    ],
    [
      'missing care case id for management plan sharing',
      {
        partnership_id: 'partnership_1',
        base_patient_id: 'patient_1',
        shared_management_plan_id: 'plan_1',
        shared_management_plan_version: 2,
      },
    ],
  ])('rejects %s before transaction side effects', async (_label, body) => {
    const response = await POST(createPostRequest(body));

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientShareCaseCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'unapproved management plan',
      {
        plan: {
          id: 'plan_1',
          case_id: 'case_1',
          status: 'draft',
          version: 2,
          case_: { patient_id: 'patient_1' },
        },
      },
    ],
    [
      'management plan for another care case',
      {
        plan: {
          id: 'plan_1',
          case_id: 'case_other',
          status: 'approved',
          version: 2,
          case_: { patient_id: 'patient_1' },
        },
      },
    ],
    [
      'management plan for another patient',
      {
        plan: {
          id: 'plan_1',
          case_id: 'case_1',
          status: 'approved',
          version: 2,
          case_: { patient_id: 'patient_other' },
        },
      },
    ],
    [
      'stale management plan version',
      {
        plan: {
          id: 'plan_1',
          case_id: 'case_1',
          status: 'approved',
          version: 3,
          case_: { patient_id: 'patient_1' },
        },
      },
    ],
  ])('rejects %s before create or audit side effects', async (_label, setup) => {
    managementPlanFindFirstMock.mockResolvedValue(setup.plan);

    const response = await POST(
      createPostRequest({
        partnership_id: 'partnership_1',
        base_patient_id: 'patient_1',
        base_case_id: 'case_1',
        shared_management_plan_id: 'plan_1',
        shared_management_plan_version: 2,
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(patientShareCaseCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
