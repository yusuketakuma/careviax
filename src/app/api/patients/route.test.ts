import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authPlumbingFailureRef,
  withAuthContextMock,
  patientFindManyMock,
  patientCreateMock,
  patientShareCaseFindManyMock,
  careCaseFindManyMock,
  facilityFindManyMock,
  userFindManyMock,
  firstVisitDocumentFindManyMock,
  queryRawMock,
  listPatientRiskSummariesMock,
  withOrgContextMock,
  assertFacilityReferenceMock,
  getFacilityVisitDefaultsMock,
  residenceCreateMock,
  contactPartyCreateManyMock,
  patientConditionCreateManyMock,
  patientPackagingProfileCreateMock,
  patientSchedulePreferenceCreateMock,
  careCaseCreateMock,
  careTeamLinkCreateManyMock,
  validateOrgReferencesMock,
  notifyWebhookEventForOrgMock,
  enforceFeatureRateLimitMock,
} = vi.hoisted(() => ({
  authPlumbingFailureRef: { current: null as Error | null },
  withAuthContextMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  patientCreateMock: vi.fn(),
  patientShareCaseFindManyMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  facilityFindManyMock: vi.fn(),
  userFindManyMock: vi.fn(),
  firstVisitDocumentFindManyMock: vi.fn(),
  queryRawMock: vi.fn(),
  listPatientRiskSummariesMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  assertFacilityReferenceMock: vi.fn(),
  getFacilityVisitDefaultsMock: vi.fn(),
  residenceCreateMock: vi.fn(),
  contactPartyCreateManyMock: vi.fn(),
  patientConditionCreateManyMock: vi.fn(),
  patientPackagingProfileCreateMock: vi.fn(),
  patientSchedulePreferenceCreateMock: vi.fn(),
  careCaseCreateMock: vi.fn(),
  careTeamLinkCreateManyMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  notifyWebhookEventForOrgMock: vi.fn(),
  enforceFeatureRateLimitMock: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: string },
      routeContext: { params: Promise<Record<string, string>> },
    ) => Promise<Response>,
  ) => {
    withAuthContextMock.mockImplementation(handler);
    return (
      req: NextRequest & {
        orgId?: string;
        userId?: string;
        role?: string;
        authResponse?: Response;
      },
      routeContext: { params: Promise<Record<string, string>> } = { params: Promise.resolve({}) },
    ) => {
      if (req.authResponse) {
        return Promise.resolve(req.authResponse);
      }
      if (authPlumbingFailureRef.current) {
        throw authPlumbingFailureRef.current;
      }

      return handler(
        req,
        {
          orgId: req.orgId ?? 'org_1',
          userId: req.userId ?? 'user_1',
          role: req.role ?? 'pharmacist',
        },
        routeContext,
      );
    };
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findMany: patientFindManyMock,
      create: patientCreateMock,
    },
    patientShareCase: {
      findMany: patientShareCaseFindManyMock,
    },
    careCase: {
      findMany: careCaseFindManyMock,
    },
    facility: {
      findMany: facilityFindManyMock,
    },
    user: {
      findMany: userFindManyMock,
    },
    firstVisitDocument: {
      findMany: firstVisitDocumentFindManyMock,
    },
    $queryRaw: queryRawMock,
  },
}));

vi.mock('@/server/services/patient-risk', () => ({
  listPatientRiskSummaries: listPatientRiskSummariesMock,
}));

vi.mock('@/server/services/outbound-webhook', () => ({
  notifyWebhookEventForOrg: notifyWebhookEventForOrgMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/lib/patient/facility-reference', () => ({
  FacilityReferenceValidationError: class FacilityReferenceValidationError extends Error {},
  FacilityUnitReferenceValidationError: class FacilityUnitReferenceValidationError extends Error {},
  assertFacilityReference: assertFacilityReferenceMock,
  assertFacilityUnitReference: vi.fn(),
  getFacilityVisitDefaults: getFacilityVisitDefaultsMock,
}));

vi.mock('@/lib/api/rate-limit', () => ({
  enforceFeatureRateLimit: enforceFeatureRateLimitMock,
}));

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

type AuthenticatedTestRequest = NextRequest & {
  orgId: string;
  userId: string;
  role: string;
  authResponse?: Response;
};

function createAuthenticatedRequest(
  url = 'http://localhost/api/patients',
  init?: ConstructorParameters<typeof NextRequest>[1],
  auth: { orgId: string; userId: string; role: string } = {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'pharmacist',
  },
): AuthenticatedTestRequest {
  return Object.assign(new NextRequest(url, init), auth);
}

function createAuthFailureRequest(status: 401 | 403, method: 'GET' | 'POST' = 'GET') {
  return Object.assign(
    new NextRequest('http://localhost/api/patients?view=match&q=青葉', { method }),
    {
      authResponse: Response.json(
        { code: status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', message: '認証エラー' },
        { status },
      ),
    },
  ) as AuthenticatedTestRequest;
}

function createJsonRequest(body: unknown, auth?: { orgId: string; userId: string; role: string }) {
  return createAuthenticatedRequest(
    'http://localhost/api/patients',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    auth,
  );
}

function createMalformedJsonRequest(auth?: { orgId: string; userId: string; role: string }) {
  return createAuthenticatedRequest(
    'http://localhost/api/patients',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"name":',
    },
    auth,
  );
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/patients GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authPlumbingFailureRef.current = null;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-20T12:00:00.000Z'));
    enforceFeatureRateLimitMock.mockResolvedValue(null);
    patientCreateMock.mockResolvedValue({ id: 'patient_new' });
    residenceCreateMock.mockResolvedValue({ id: 'residence_new' });
    contactPartyCreateManyMock.mockResolvedValue({ count: 1 });
    patientConditionCreateManyMock.mockResolvedValue({ count: 1 });
    patientPackagingProfileCreateMock.mockResolvedValue({ id: 'packaging_new' });
    patientSchedulePreferenceCreateMock.mockResolvedValue({ id: 'schedule_pref_new' });
    careCaseCreateMock.mockResolvedValue({ id: 'case_new' });
    careTeamLinkCreateManyMock.mockResolvedValue({ count: 2 });
    validateOrgReferencesMock.mockResolvedValue({ ok: true });
    notifyWebhookEventForOrgMock.mockResolvedValue([]);
    getFacilityVisitDefaultsMock.mockResolvedValue(null);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patient: {
          create: patientCreateMock,
        },
        residence: {
          create: residenceCreateMock,
        },
        contactParty: {
          createMany: contactPartyCreateManyMock,
        },
        patientCondition: {
          createMany: patientConditionCreateManyMock,
        },
        patientPackagingProfile: {
          create: patientPackagingProfileCreateMock,
        },
        patientSchedulePreference: {
          create: patientSchedulePreferenceCreateMock,
        },
        careCase: {
          create: careCaseCreateMock,
        },
        careTeamLink: {
          createMany: careTeamLinkCreateManyMock,
        },
      }),
    );
    firstVisitDocumentFindManyMock.mockResolvedValue([{ case_id: 'case_1' }]);
    patientShareCaseFindManyMock.mockResolvedValue([
      {
        base_patient_id: 'patient_1',
        share_scope: {
          prescription_history: true,
          medication_profile: true,
          care_reports: false,
          attachments: true,
          print: false,
          pdf_output: false,
          download: false,
        },
        partnership: { partner_pharmacy_id: 'partner_pharmacy_1' },
      },
      {
        base_patient_id: 'patient_1',
        share_scope: {
          prescription_history: true,
          medication_profile: false,
          care_reports: true,
          attachments: false,
          print: false,
          pdf_output: false,
          download: false,
        },
        partnership: { partner_pharmacy_id: 'partner_pharmacy_2' },
      },
    ]);
    careCaseFindManyMock.mockResolvedValue([
      { id: 'case_1', patient_id: 'patient_1' },
      { id: 'case_1b', patient_id: 'patient_1' },
      { id: 'case_2', patient_id: 'patient_2' },
    ]);
    patientFindManyMock.mockResolvedValue([
      {
        id: 'patient_1',
        name: '青葉 花子',
        name_kana: 'アオバ ハナコ',
        birth_date: new Date('1948-05-20'),
        gender: 'female',
        phone: '090-0000-0001',
        medical_insurance_number: 'med-001',
        care_insurance_number: null,
        billing_support_flag: true,
        scheduling_preference: {
          preferred_contact_name: '長女',
          preferred_contact_phone: '03-2222-0000',
          visit_before_contact_required: true,
          parking_available: true,
          care_level: 'care_2',
        },
        residences: [
          {
            address: '東京都千代田区1-1-1',
            building_id: 'facility_alpha',
            unit_name: '201',
          },
        ],
        _count: { contacts: 1 },
        contacts: [
          {
            id: 'contact_1',
            is_primary: true,
            is_emergency_contact: true,
            phone: '03-0000-0000',
            email: 'family@example.test',
            fax: '03-0000-9999',
          },
        ],
        conditions: [
          {
            id: 'condition_1',
            condition_type: 'disease',
            name: '糖尿病',
            is_primary: true,
          },
        ],
        cases: [
          {
            id: 'case_1',
            status: 'active',
            updated_at: new Date('2026-03-27T09:00:00.000Z'),
            primary_pharmacist_id: 'user_1',
            care_team_links: [
              {
                id: 'link_1',
                role: 'physician',
                phone: '03-1111-0000',
                email: 'doctor@example.test',
                fax: '03-1111-9999',
                is_primary: true,
              },
            ],
          },
        ],
        consents: [{ id: 'consent_1' }],
      },
      {
        id: 'patient_2',
        name: '鈴木 次郎',
        name_kana: 'スズキ ジロウ',
        birth_date: new Date('1952-10-01'),
        gender: 'male',
        phone: null,
        medical_insurance_number: null,
        care_insurance_number: null,
        billing_support_flag: false,
        scheduling_preference: null,
        residences: [
          {
            address: '東京都墨田区2-2-2',
            building_id: null,
            unit_name: null,
          },
        ],
        _count: { contacts: 0 },
        contacts: [],
        conditions: [],
        cases: [
          {
            id: 'case_2',
            status: 'assessment',
            updated_at: new Date('2026-03-20T09:00:00.000Z'),
            primary_pharmacist_id: null,
            care_team_links: [],
          },
        ],
        consents: [],
      },
    ]);
    userFindManyMock.mockResolvedValue([{ id: 'user_1', name: '佐藤 薬剤師' }]);
    facilityFindManyMock.mockResolvedValue([
      {
        id: 'facility_alpha',
        name: 'あおば苑',
      },
    ]);
    // First $queryRaw call: latest visit per patient (DISTINCT ON)
    // Second $queryRaw call: upcoming schedules per case (ROW_NUMBER)
    queryRawMock
      .mockResolvedValueOnce([
        {
          id: 'visit_1',
          patient_id: 'patient_1',
          visit_date: new Date('2026-03-25T00:00:00.000Z'),
          outcome_status: 'completed',
          created_at: new Date('2026-03-25T10:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'schedule_1',
          case_id: 'case_1',
          scheduled_date: new Date('2026-03-30T00:00:00.000Z'),
          schedule_status: 'scheduled',
          priority: 'normal',
        },
      ]);
    listPatientRiskSummariesMock.mockResolvedValue([
      {
        patient_id: 'patient_1',
        patient_name: '青葉 花子',
        score: 5,
        level: 'watch',
        reasons: ['訪問同意が未整備です'],
        unresolved_self_reports: 0,
        open_issues: 0,
        disrupted_visits_30d: 0,
        pending_reports: 0,
        open_tasks: 0,
        missing_visit_consent: true,
        missing_management_plan: false,
      },
      {
        patient_id: 'patient_2',
        patient_name: '鈴木 次郎',
        score: 0,
        level: 'stable',
        reasons: [],
        unresolved_self_reports: 0,
        open_issues: 0,
        disrupted_visits_30d: 0,
        pending_reports: 0,
        open_tasks: 0,
        missing_visit_consent: false,
        missing_management_plan: false,
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('supports advanced patient filters and enriches risk, consent, and assignment fields', async () => {
    const response = (await GET(
      createAuthenticatedRequest(
        'http://localhost/api/patients?q=青葉&facility_mode=facility&consent_status=complete&risk_level=watch&last_visit=within_30_days',
      ),
    ))!;

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(patientFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          archived_at: null,
        }),
      }),
    );
    expect(listPatientRiskSummariesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        patientIds: ['patient_1', 'patient_2'],
        caseIdsByPatient: {
          patient_1: ['case_1', 'case_1b'],
          patient_2: ['case_2'],
        },
        includeStable: true,
      }),
    );
    expect(String(queryRawMock.mock.calls[0]?.[0])).toContain('INNER JOIN "CareCase"');

    const payload = (await response.json()) as {
      data: Array<{
        id: string;
        facility_mode: 'facility' | 'home';
        contacts: Array<{
          id: string;
          is_primary: boolean | null;
          is_emergency_contact: boolean | null;
          phone?: string | null;
          email?: string | null;
          fax?: string | null;
        }>;
        cases: Array<{
          care_team_links: Array<{
            id: string;
            role: string;
            is_primary: boolean | null;
            phone?: string | null;
            email?: string | null;
            fax?: string | null;
          }>;
        }>;
        latest_case: {
          primary_pharmacist_name: string | null;
          care_team_links: Array<{
            id: string;
            role: string;
            is_primary: boolean | null;
            phone?: string | null;
            email?: string | null;
            fax?: string | null;
          }>;
        } | null;
        scheduling_preference: {
          preferred_contact_name?: string | null;
          preferred_contact_phone?: string | null;
          visit_before_contact_required: boolean | null;
          parking_available: boolean | null;
          care_level: string | null;
        } | null;
        consent: { has_visit_medication_management: boolean };
        pharmacy_share: {
          status: 'none' | 'active';
          active_case_count: number;
          partner_pharmacy_count: number;
          scope_keys: string[];
        };
        risk_summary: { level: 'stable' | 'watch' | 'high' };
        archive: {
          status: 'active' | 'archived';
          archived: boolean;
          archived_at: string | null;
        };
      }>;
      summary: {
        total: number;
        active_count: number;
        archived_count: number;
        facility_count: number;
        missing_consent_count: number;
        by_risk: Record<'stable' | 'watch' | 'high', number>;
      };
    };

    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]).toMatchObject({
      id: 'patient_1',
      facility_mode: 'facility',
      latest_case: {
        primary_pharmacist_name: '佐藤 薬剤師',
      },
      consent: {
        has_visit_medication_management: true,
      },
      pharmacy_share: {
        status: 'active',
        active_case_count: 2,
        partner_pharmacy_count: 2,
        scope_keys: ['attachments', 'care_reports', 'medication_profile', 'prescription_history'],
      },
      risk_summary: {
        level: 'watch',
      },
      archive: {
        status: 'active',
        archived: false,
        archived_at: null,
      },
    });
    expect(payload.data[0].contacts[0]).toEqual({
      id: 'contact_1',
      is_primary: true,
      is_emergency_contact: true,
    });
    expect(payload.data[0].latest_case?.care_team_links[0]).toEqual({
      id: 'link_1',
      role: 'physician',
      is_primary: true,
    });
    expect(payload.data[0].cases[0]?.care_team_links[0]).toEqual({
      id: 'link_1',
      role: 'physician',
      is_primary: true,
    });
    expect(payload.data[0].scheduling_preference).toEqual({
      visit_before_contact_required: true,
      parking_available: true,
      care_level: 'care_2',
    });
    expect(payload.data[0].scheduling_preference).not.toHaveProperty('preferred_contact_name');
    expect(payload.data[0].scheduling_preference).not.toHaveProperty('preferred_contact_phone');
    const serializedPayload = JSON.stringify(payload);
    expect(serializedPayload).not.toContain('03-0000-0000');
    expect(serializedPayload).not.toContain('family@example.test');
    expect(serializedPayload).not.toContain('03-0000-9999');
    expect(serializedPayload).not.toContain('03-1111-0000');
    expect(serializedPayload).not.toContain('doctor@example.test');
    expect(serializedPayload).not.toContain('03-1111-9999');
    expect(serializedPayload).not.toContain('長女');
    expect(serializedPayload).not.toContain('03-2222-0000');
    expect(payload.summary).toMatchObject({
      total: 1,
      active_count: 1,
      archived_count: 0,
      facility_count: 1,
      missing_consent_count: 0,
      by_risk: {
        stable: 0,
        watch: 1,
        high: 0,
      },
    });
    expect(payload).toMatchSnapshot();
  });

  it('returns archived patient state only when archive_status=archived is explicit', async () => {
    patientFindManyMock.mockResolvedValueOnce([
      {
        id: 'patient_archived',
        name: '保管 太郎',
        name_kana: 'ホカン タロウ',
        birth_date: new Date('1948-05-20'),
        gender: 'male',
        phone: null,
        medical_insurance_number: null,
        care_insurance_number: null,
        billing_support_flag: false,
        archived_at: new Date('2026-04-01T09:30:00.000Z'),
        scheduling_preference: null,
        residences: [],
        _count: { contacts: 0 },
        contacts: [],
        conditions: [],
        cases: [
          {
            id: 'case_archived',
            status: 'terminated',
            updated_at: new Date('2026-03-27T09:00:00.000Z'),
            primary_pharmacist_id: null,
            care_team_links: [],
          },
        ],
        consents: [],
      },
    ]);

    const response = (await GET(
      createAuthenticatedRequest('http://localhost/api/patients?archive_status=archived'),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(patientFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          archived_at: { not: null },
        }),
      }),
    );
    const payload = (await response.json()) as {
      data: Array<{
        id: string;
        archived_at: string | null;
        archive: { status: 'active' | 'archived'; archived: boolean; archived_at: string | null };
      }>;
      summary: { total: number; active_count: number; archived_count: number };
    };

    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]).toMatchObject({
      id: 'patient_archived',
      archived_at: '2026-04-01T09:30:00.000Z',
      archive: {
        status: 'archived',
        archived: true,
        archived_at: '2026-04-01T09:30:00.000Z',
      },
    });
    expect(payload.summary).toMatchObject({
      total: 1,
      active_count: 0,
      archived_count: 1,
    });
  });

  it('preserves legacy unknown query keys while validating known patient filters', async () => {
    const response = (await GET(
      createAuthenticatedRequest('http://localhost/api/patients?per_page=5&q=青葉'),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(patientFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          archived_at: null,
        }),
      }),
    );
  });

  it('returns a fixed sensitive no-store error when patient list reads fail', async () => {
    patientFindManyMock.mockRejectedValueOnce(new Error('raw patient list failure'));

    const response = (await GET(createAuthenticatedRequest('http://localhost/api/patients')))!;
    const body = await response.json();

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).toBe('サーバー内部でエラーが発生しました');
    expect(JSON.stringify(body)).not.toContain('raw patient list failure');
  });

  it('returns a fixed sensitive no-store error when patient search reads fail', async () => {
    patientFindManyMock.mockRejectedValueOnce(new Error('raw patient search failure 青葉 花子'));

    const response = (await GET(
      createAuthenticatedRequest('http://localhost/api/patients?view=search&q=青葉&limit=1'),
    ))!;
    const body = await response.json();

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expect(body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('raw patient search failure');
    expect(JSON.stringify(body)).not.toContain('青葉 花子');
  });

  it('returns a bounded minimal patient projection for palette search', async () => {
    patientFindManyMock.mockResolvedValueOnce([
      {
        id: 'patient_1',
        name: '青葉 花子',
        name_kana: 'アオバ ハナコ',
        birth_date: new Date('1948-05-20'),
        phone: '090-0000-0001',
        medical_insurance_number: 'MED-SECRET-1',
        residences: [{ address: '東京都千代田区1-1-1' }],
        contacts: [{ phone: '03-0000-0000', email: 'family@example.test' }],
        conditions: [{ name: '糖尿病' }],
      },
      {
        id: 'patient_2',
        name: '青葉 次郎',
        name_kana: 'アオバ ジロウ',
        birth_date: new Date('1952-10-01'),
        phone: '090-0000-0002',
        care_insurance_number: 'CARE-SECRET-1',
        residences: [{ address: '東京都墨田区2-2-2' }],
        contacts: [{ phone: '03-0000-0001' }],
        conditions: [{ name: '高血圧' }],
      },
    ]);

    const response = (await GET(
      createAuthenticatedRequest('http://localhost/api/patients?view=palette&q=青葉&limit=1'),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toEqual({
      data: [
        {
          id: 'patient_1',
          name: '青葉 花子',
          name_kana: 'アオバ ハナコ',
        },
      ],
      hasMore: true,
    });
    expect(patientFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          archived_at: null,
        }),
        take: 2,
        select: {
          id: true,
          name: true,
          name_kana: true,
        },
      }),
    );
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(listPatientRiskSummariesMock).not.toHaveBeenCalled();
    expect(patientShareCaseFindManyMock).not.toHaveBeenCalled();
    expect(firstVisitDocumentFindManyMock).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain('090-0000-0001');
    expect(JSON.stringify(body)).not.toContain('MED-SECRET-1');
    expect(JSON.stringify(body)).not.toContain('東京都千代田区');
    expect(JSON.stringify(body)).not.toContain('family@example.test');
    expect(JSON.stringify(body)).not.toContain('糖尿病');
    expect(body.data[0]).not.toHaveProperty('birth_date');
    expect(body.data[0]).not.toHaveProperty('phone');
    expect(body.data[0]).not.toHaveProperty('medical_insurance_number');
    expect(body.data[0]).not.toHaveProperty('residences');
    expect(body.data[0]).not.toHaveProperty('contacts');
    expect(body.data[0]).not.toHaveProperty('conditions');
  });

  it('returns bounded patient search summaries without full-list enrichment fields', async () => {
    patientFindManyMock.mockResolvedValueOnce([
      {
        id: 'patient_1',
        name: '青葉 花子',
        name_kana: 'アオバ ハナコ',
        birth_date: new Date('1948-05-20'),
        phone: '090-0000-0001',
        medical_insurance_number: 'MED-SECRET-1',
        care_insurance_number: 'CARE-SECRET-1',
        residences: [{ address: '東京都千代田区1-1-1' }],
        contacts: [{ phone: '03-0000-0000', email: 'family@example.test' }],
        conditions: [
          { name: '糖尿病', is_primary: true, notes: 'hidden condition note' },
          { name: '高血圧', is_primary: false, notes: 'hidden secondary note' },
        ],
        cases: [
          {
            notes: 'hidden case note',
            visit_schedules: [
              {
                scheduled_date: new Date('2026-06-17T00:00:00.000Z'),
                carry_items_status: 'ready',
              },
            ],
          },
        ],
      },
      {
        id: 'patient_2',
        name: '青葉 次郎',
        name_kana: 'アオバ ジロウ',
        phone: '090-0000-0002',
        residences: [{ address: '東京都墨田区2-2-2' }],
        contacts: [{ phone: '03-0000-0001' }],
        conditions: [{ name: '心不全', is_primary: true }],
        cases: [{ visit_schedules: [] }],
      },
    ]);

    const response = (await GET(
      createAuthenticatedRequest('http://localhost/api/patients?view=search&q=青葉&limit=1'),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toEqual({
      data: [
        {
          id: 'patient_1',
          name: '青葉 花子',
          name_kana: 'アオバ ハナコ',
          conditions: [
            { name: '糖尿病', is_primary: true },
            { name: '高血圧', is_primary: false },
          ],
          visit_schedules: [{ scheduled_date: '2026-06-17T00:00:00.000Z' }],
        },
      ],
      hasMore: true,
    });
    expect(patientFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          archived_at: null,
        }),
        take: 2,
        select: expect.objectContaining({
          id: true,
          name: true,
          name_kana: true,
          conditions: {
            where: { is_active: true },
            orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
            take: 2,
            select: {
              name: true,
              is_primary: true,
            },
          },
          cases: {
            take: 1,
            orderBy: { updated_at: 'desc' },
            select: {
              visit_schedules: {
                orderBy: [{ scheduled_date: 'asc' }, { time_window_start: 'asc' }],
                take: 1,
                select: {
                  scheduled_date: true,
                },
              },
            },
          },
        }),
      }),
    );
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(listPatientRiskSummariesMock).not.toHaveBeenCalled();
    expect(patientShareCaseFindManyMock).not.toHaveBeenCalled();
    expect(firstVisitDocumentFindManyMock).not.toHaveBeenCalled();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('090-0000-0001');
    expect(serialized).not.toContain('MED-SECRET-1');
    expect(serialized).not.toContain('CARE-SECRET-1');
    expect(serialized).not.toContain('東京都千代田区');
    expect(serialized).not.toContain('family@example.test');
    expect(serialized).not.toContain('hidden condition note');
    expect(serialized).not.toContain('hidden case note');
    expect(serialized).not.toContain('carry_items_status');
    expect(body.data[0]).not.toHaveProperty('birth_date');
    expect(body.data[0]).not.toHaveProperty('phone');
    expect(body.data[0]).not.toHaveProperty('medical_insurance_number');
    expect(body.data[0]).not.toHaveProperty('care_insurance_number');
    expect(body.data[0]).not.toHaveProperty('residences');
    expect(body.data[0]).not.toHaveProperty('contacts');
    expect(body.data[0]).not.toHaveProperty('risk_summary');
    expect(body.data[0]).not.toHaveProperty('pharmacy_share');
    expect(body.data[0]).not.toHaveProperty('readiness');
  });

  it.each([401, 403] as const)(
    'adds no-store headers to patient auth failure %s',
    async (status) => {
      const response = (await GET(createAuthFailureRequest(status)))!;

      expect(response.status).toBe(status);
      expectSensitiveNoStore(response);
      expect(patientFindManyMock).not.toHaveBeenCalled();
      expect(queryRawMock).not.toHaveBeenCalled();
      expect(listPatientRiskSummariesMock).not.toHaveBeenCalled();
    },
  );

  it('returns bounded patient match summaries for QR and prescription patient lookup', async () => {
    patientFindManyMock.mockResolvedValueOnce([
      {
        id: 'patient_1',
        name: '青葉 花子',
        name_kana: 'アオバ ハナコ',
        birth_date: new Date('1948-05-20'),
        gender: 'female',
        phone: '090-0000-0001',
        medical_insurance_number: 'MED-SECRET-1',
        care_insurance_number: 'CARE-SECRET-1',
        residences: [{ address: '東京都千代田区1-1-1' }],
        contacts: [{ phone: '03-0000-0000', email: 'family@example.test' }],
        conditions: [{ name: '糖尿病', is_primary: true }],
        cases: [{ care_team_links: [{ phone: '03-1111-0000', fax: '03-1111-9999' }] }],
      },
      {
        id: 'patient_2',
        name: '青葉 次郎',
        name_kana: 'アオバ ジロウ',
        birth_date: new Date('1952-10-01'),
        gender: 'male',
        phone: '090-0000-0002',
        contacts: [],
        conditions: [],
        cases: [],
      },
    ]);

    const response = (await GET(
      createAuthenticatedRequest('http://localhost/api/patients?view=match&q=青葉&limit=1'),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toEqual({
      data: [
        {
          id: 'patient_1',
          name: '青葉 花子',
          name_kana: 'アオバ ハナコ',
          birth_date: '1948-05-20',
          gender: 'female',
        },
      ],
      hasMore: true,
    });
    expect(patientFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          archived_at: null,
        }),
        take: 2,
        select: {
          id: true,
          name: true,
          name_kana: true,
          birth_date: true,
          gender: true,
        },
      }),
    );
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(listPatientRiskSummariesMock).not.toHaveBeenCalled();
    expect(patientShareCaseFindManyMock).not.toHaveBeenCalled();
    expect(firstVisitDocumentFindManyMock).not.toHaveBeenCalled();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('090-0000-0001');
    expect(serialized).not.toContain('MED-SECRET-1');
    expect(serialized).not.toContain('CARE-SECRET-1');
    expect(serialized).not.toContain('東京都千代田区');
    expect(serialized).not.toContain('family@example.test');
    expect(serialized).not.toContain('03-1111-0000');
    expect(body.data[0]).not.toHaveProperty('contacts');
    expect(body.data[0]).not.toHaveProperty('conditions');
    expect(body.data[0]).not.toHaveProperty('cases');
    expect(body.data[0]).not.toHaveProperty('risk_summary');
    expect(body.data[0]).not.toHaveProperty('pharmacy_share');
    expect(body.data[0]).not.toHaveProperty('readiness');
  });

  it.each([
    {
      url: 'http://localhost/api/patients?view=match',
      details: { q: ['match 表示では q を指定してください'] },
    },
    {
      url: 'http://localhost/api/patients?view=match&q=',
      details: { q: ['match 表示では q を指定してください'] },
    },
    {
      url: 'http://localhost/api/patients?view=match&q=青葉&limit=51',
      details: { limit: ['match 表示では limit は 1〜50 の整数で指定してください'] },
    },
    {
      url: 'http://localhost/api/patients?view=match&q=青葉&limit=1e2',
      details: { limit: ['limit は整数で指定してください'] },
    },
    {
      url: 'http://localhost/api/patients?view=match&q=青葉&risk_level=watch',
      details: {
        risk_level: ['match 表示では q/limit/sort/order/archive_status のみ指定できます'],
      },
    },
    {
      url: 'http://localhost/api/patients?view=match&view=palette&q=青葉',
      details: { view: ['view は1つだけ指定してください'] },
    },
  ])(
    'rejects invalid match patient search query $url before DB access',
    async ({ url, details }) => {
      vi.clearAllMocks();

      const response = (await GET(createAuthenticatedRequest(url)))!;

      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        details,
      });
      expect(patientFindManyMock).not.toHaveBeenCalled();
      expect(queryRawMock).not.toHaveBeenCalled();
      expect(listPatientRiskSummariesMock).not.toHaveBeenCalled();
      expect(patientShareCaseFindManyMock).not.toHaveBeenCalled();
      expect(firstVisitDocumentFindManyMock).not.toHaveBeenCalled();
    },
  );

  it('rejects full-list-only filters in palette patient search before querying patients', async () => {
    const response = (await GET(
      createAuthenticatedRequest(
        'http://localhost/api/patients?view=palette&q=青葉&risk_level=watch',
      ),
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'palette 表示では対応していない検索条件です',
      details: {
        risk_level: ['palette 表示では q/limit/sort/order/archive_status のみ指定できます'],
      },
    });
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(listPatientRiskSummariesMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate patient list query keys before reaching patient filtering', async () => {
    const response = (await GET(
      createAuthenticatedRequest('http://localhost/api/patients?q=青葉&q=鈴木'),
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);

    const payload = (await response.json()) as {
      code: string;
      details?: { q?: string[] };
    };

    expect(payload.code).toBe('VALIDATION_ERROR');
    expect(payload.details?.q).toEqual(['q は1つだけ指定してください']);
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(listPatientRiskSummariesMock).not.toHaveBeenCalled();
  });

  it('rejects palette patient limits above 50 before querying patients', async () => {
    const response = (await GET(
      createAuthenticatedRequest('http://localhost/api/patients?view=palette&q=青葉&limit=51'),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'limit は 1〜50 の整数で指定してください',
      details: {
        limit: ['palette 表示では limit は 1〜50 の整数で指定してください'],
      },
    });
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(queryRawMock).not.toHaveBeenCalled();
  });

  it('supports case, building, billing, and last-visit date filters together', async () => {
    const response = (await GET(
      createAuthenticatedRequest(
        'http://localhost/api/patients?case_status=active&building_id=facility_alpha&billing_support=true&last_visit_from=2026-03-01&last_visit_to=2026-03-31',
      ),
    ))!;

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      data: Array<{ id: string }>;
      summary: { total: number };
    };

    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]).toMatchObject({ id: 'patient_1' });
    expect(payload.summary.total).toBe(1);
  });

  it('rejects invalid case_status values', async () => {
    const response = (await GET(
      createAuthenticatedRequest('http://localhost/api/patients?case_status=active,invalid_status'),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        case_status: expect.arrayContaining(['case_status の値が不正です']),
      },
    });
  });

  it('rejects invalid case_status query values before reaching patient filtering', async () => {
    const response = (await GET(
      createAuthenticatedRequest('http://localhost/api/patients?case_status=active,unknown'),
    ))!;

    expect(response.status).toBe(400);

    const payload = (await response.json()) as {
      code: string;
      details?: { case_status?: string[] };
    };

    expect(payload.code).toBe('VALIDATION_ERROR');
    expect(payload.details?.case_status?.[0]).toBe('case_status の値が不正です');
    expect(patientFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects malformed limit values before reaching patient filtering', async () => {
    const response = (await GET(
      createAuthenticatedRequest('http://localhost/api/patients?limit=1e2'),
    ))!;

    expect(response.status).toBe(400);

    const payload = (await response.json()) as {
      code: string;
      details?: { limit?: string[] };
    };

    expect(payload.code).toBe('VALIDATION_ERROR');
    expect(payload.details?.limit?.[0]).toBe('limit は整数で指定してください');
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(listPatientRiskSummariesMock).not.toHaveBeenCalled();
  });

  it('supports payer-basis and primary pharmacist filters', async () => {
    const response = (await GET(
      createAuthenticatedRequest(
        'http://localhost/api/patients?payer_basis=medical&primary_pharmacist_id=user_1',
      ),
    ))!;

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      data: Array<{ id: string }>;
      summary: { total: number };
    };

    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]).toMatchObject({ id: 'patient_1' });
    expect(payload.summary.total).toBe(1);
  });

  it('supports readiness_issue filters for onboarding gaps', async () => {
    firstVisitDocumentFindManyMock.mockResolvedValue([]);

    const response = (await GET(
      createAuthenticatedRequest(
        'http://localhost/api/patients?readiness_issue=missing_primary_physician',
      ),
    ))!;

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      data: Array<{
        id: string;
        readiness: { has_primary_physician: boolean };
      }>;
      summary: { total: number };
    };

    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]).toMatchObject({
      id: 'patient_2',
      readiness: {
        has_primary_physician: false,
      },
    });
    expect(payload.summary.total).toBe(1);
  });

  it('supports foundation_issue filters for patient foundation gaps', async () => {
    const response = (await GET(
      createAuthenticatedRequest(
        'http://localhost/api/patients?foundation_issue=missing_insurance',
      ),
    ))!;

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      data: Array<{
        id: string;
        medical_insurance_number: string | null;
        care_insurance_number: string | null;
      }>;
      summary: { total: number };
    };

    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]).toMatchObject({
      id: 'patient_2',
      medical_insurance_number: null,
      care_insurance_number: null,
    });
    expect(payload.summary.total).toBe(1);
  });

  it('uses raw contact channels for missing_contact filtering without exposing them', async () => {
    const response = (await GET(
      createAuthenticatedRequest('http://localhost/api/patients?foundation_issue=missing_contact'),
    ))!;

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: Array<{ id: string }>;
      summary: { total: number };
    };

    expect(payload.data.map((patient) => patient.id)).toEqual(['patient_2']);
    expect(payload.summary.total).toBe(1);
    const serializedPayload = JSON.stringify(payload);
    expect(serializedPayload).not.toContain('03-0000-0000');
    expect(serializedPayload).not.toContain('family@example.test');
    expect(serializedPayload).not.toContain('03-2222-0000');
  });

  it('uses raw care-team channels for missing_care_team filtering without exposing them', async () => {
    patientFindManyMock.mockResolvedValueOnce([
      {
        id: 'patient_1',
        name: '青葉 花子',
        name_kana: 'アオバ ハナコ',
        birth_date: new Date('1948-05-20'),
        gender: 'female',
        phone: '090-0000-0001',
        medical_insurance_number: 'med-001',
        care_insurance_number: null,
        billing_support_flag: true,
        scheduling_preference: {
          preferred_contact_name: null,
          preferred_contact_phone: null,
          visit_before_contact_required: false,
          parking_available: true,
          care_level: 'care_2',
        },
        residences: [
          {
            address: '東京都千代田区1-1-1',
            building_id: 'facility_alpha',
            unit_name: '201',
          },
        ],
        _count: { contacts: 1 },
        contacts: [
          {
            id: 'contact_1',
            is_primary: true,
            is_emergency_contact: true,
            phone: '03-4444-0000',
            email: null,
            fax: null,
          },
        ],
        conditions: [],
        cases: [
          {
            id: 'case_1',
            status: 'active',
            updated_at: new Date('2026-03-27T09:00:00.000Z'),
            primary_pharmacist_id: 'user_1',
            care_team_links: [
              {
                id: 'link_physician',
                role: 'physician',
                phone: '03-5555-0001',
                fax: '03-5555-1001',
                email: 'doctor@example.test',
                is_primary: true,
              },
              {
                id: 'link_nurse',
                role: 'nurse',
                phone: '03-5555-0002',
                fax: '03-5555-1002',
                email: 'nurse@example.test',
                is_primary: true,
              },
              {
                id: 'link_cm',
                role: 'care_manager',
                phone: '03-5555-0003',
                fax: '03-5555-1003',
                email: 'cm@example.test',
                is_primary: true,
              },
            ],
          },
        ],
        consents: [{ id: 'consent_1' }],
      },
      {
        id: 'patient_2',
        name: '鈴木 次郎',
        name_kana: 'スズキ ジロウ',
        birth_date: new Date('1952-10-01'),
        gender: 'male',
        phone: null,
        medical_insurance_number: null,
        care_insurance_number: null,
        billing_support_flag: false,
        scheduling_preference: null,
        residences: [],
        _count: { contacts: 0 },
        contacts: [],
        conditions: [],
        cases: [
          {
            id: 'case_2',
            status: 'assessment',
            updated_at: new Date('2026-03-20T09:00:00.000Z'),
            primary_pharmacist_id: null,
            care_team_links: [],
          },
        ],
        consents: [],
      },
    ]);

    const response = (await GET(
      createAuthenticatedRequest(
        'http://localhost/api/patients?foundation_issue=missing_care_team',
      ),
    ))!;

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: Array<{ id: string }>;
      summary: { total: number };
    };

    expect(payload.data.map((patient) => patient.id)).toEqual(['patient_2']);
    expect(payload.summary.total).toBe(1);
    const serializedPayload = JSON.stringify(payload);
    expect(serializedPayload).not.toContain('03-4444-0000');
    expect(serializedPayload).not.toContain('03-5555-0001');
    expect(serializedPayload).not.toContain('doctor@example.test');
    expect(serializedPayload).not.toContain('03-5555-1003');
  });

  it('uses the database cursor when paginating filtered results', async () => {
    patientFindManyMock.mockResolvedValueOnce([
      {
        id: 'patient_2',
        name: '鈴木 次郎',
        name_kana: 'スズキ ジロウ',
        birth_date: new Date('1952-10-01'),
        gender: 'male',
        phone: null,
        medical_insurance_number: null,
        care_insurance_number: null,
        billing_support_flag: false,
        residences: [
          {
            address: '東京都墨田区2-2-2',
            building_id: null,
            unit_name: null,
          },
        ],
        _count: { contacts: 0 },
        contacts: [],
        conditions: [],
        cases: [
          {
            id: 'case_2',
            status: 'assessment',
            updated_at: new Date('2026-03-20T09:00:00.000Z'),
            primary_pharmacist_id: null,
            care_team_links: [],
          },
        ],
        consents: [],
      },
    ]);
    queryRawMock.mockResolvedValue([]);
    listPatientRiskSummariesMock.mockResolvedValue([]);

    const response = (await GET(
      createAuthenticatedRequest('http://localhost/api/patients?cursor=patient_1&limit=%201%20'),
    ))!;

    expect(response.status).toBe(200);
    expect(patientFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: 'patient_1' },
        skip: 1,
        take: 101,
      }),
    );
  });

  it('masks phone and insurance fields for users without sensitive data access', async () => {
    const response = (await GET(
      createAuthenticatedRequest('http://localhost/api/patients', undefined, {
        orgId: 'org_1',
        userId: 'user_2',
        role: 'clerk',
      }),
    ))!;

    if (!response) throw new Error('response is required');
    const payload = (await response.json()) as {
      data: Array<{
        id: string;
        phone: string | null;
        medical_insurance_number: string | null;
      }>;
      privacy: {
        sensitive_fields_masked: boolean;
        address_fields_masked: boolean;
        can_view_detail: boolean;
      };
    };

    expect(payload.privacy.sensitive_fields_masked).toBe(true);
    expect(payload.privacy.address_fields_masked).toBe(false);
    expect(payload.privacy.can_view_detail).toBe(true);
    expect(payload.data[0]).toMatchObject({
      id: 'patient_1',
      phone: '***-****-0001',
      medical_insurance_number: '***-001',
    });
  });

  it('masks address and disables detail viewing for external viewers', async () => {
    const response = (await GET(
      createAuthenticatedRequest('http://localhost/api/patients', undefined, {
        orgId: 'org_1',
        userId: 'user_ext',
        role: 'external_viewer',
      }),
    ))!;

    if (!response) throw new Error('response is required');
    const payload = (await response.json()) as {
      data: Array<{
        id: string;
        phone: string | null;
        medical_insurance_number: string | null;
        residences: Array<{ address: string | null }>;
      }>;
      privacy: {
        sensitive_fields_masked: boolean;
        address_fields_masked: boolean;
        can_view_detail: boolean;
      };
    };

    expect(payload.privacy).toMatchObject({
      sensitive_fields_masked: true,
      address_fields_masked: true,
      can_view_detail: false,
    });
    expect(payload.data[0]).toMatchObject({
      id: 'patient_1',
      phone: '***-****-0001',
      medical_insurance_number: '***-001',
    });
    expect(payload.data[0].residences[0]?.address).toBe('東京都千代田***');
  });

  it('persists rich intake payload into canonical tables and intake-only case metadata', async () => {
    patientFindManyMock.mockResolvedValueOnce([]);
    patientCreateMock.mockResolvedValue({
      id: 'patient_new',
      name: '訪問 花子',
    });

    const response = (await POST(
      createJsonRequest({
        name: '訪問 花子',
        gender: 'female',
        billing_support_flag: true,
        address: '東京都千代田区1-2-3',
        allergy_info: [
          {
            drug_name: 'ペニシリン',
            category: 'drug',
            severity: 'moderate',
            confirmed_at: '2026-03-01',
          },
        ],
        requester: {
          organization_name: '千代田クリニック',
          profession: 'physician',
          contact_name: '連携 太郎',
          phone: ' 03-1111-2222 ',
          fax: ' 03-1111-3333 ',
          preferred_contact_method: 'mcs',
        },
        intake: {
          age: 82,
          primary_disease: '心不全',
          contact_phone: ' 03-3333-4444 ',
          primary_contact_preference: 'phone',
          visit_before_contact_required: true,
          care_level: 'care_3',
          medication_support_methods: ['unit_dose', 'calendar'],
          parking_available: false,
          mcs_linked: true,
          ent_prescription: true,
          ent_period_from: '2026-04-01',
          ent_period_to: '2026-04-30',
          home_pharmacy_add_on_2: {
            candidate: 'add_on_2_ro_candidate',
            single_building_medical_patient_count: 'two_to_nine',
            single_building_resident_count: 'ten_or_more',
            home_care_billing_category: 'medical_home_visit',
            medical_home_management_type: 'facility_medical_management',
            comprehensive_support_add_on: 'yes',
            table_8_2_applicable: 'unknown',
            medical_care_child: 'no',
            visiting_nurse_frequency: 'weekly',
            narcotic_use_categories: ['base', 'rescue'],
            aseptic_preparation_need: 'necessary',
          },
          care_manager: {
            name: 'ケア 山田',
            organization_name: '地域ケア',
            phone: ' 03-9999-0000 ',
            fax: ' 03-9999-1111 ',
          },
          special_medical_procedures: ['narcotics', 'home_oxygen'],
        },
      }),
    ))!;

    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(assertFacilityReferenceMock).toHaveBeenCalled();
    expect(patientCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: '訪問 花子',
          phone: '03-3333-4444',
          birth_date: expect.any(Date),
          billing_support_flag: true,
          allergy_info: [
            {
              drug_name: 'ペニシリン',
              category: 'drug',
              severity: 'moderate',
              confirmed_at: '2026-03-01',
            },
          ],
        }),
      }),
    );
    expect(patientConditionCreateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            name: '心不全',
            is_primary: true,
          }),
        ]),
      }),
    );
    expect(patientPackagingProfileCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          default_packaging_method: 'unit_dose',
        }),
      }),
    );
    expect(patientSchedulePreferenceCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          facility_time_from: null,
          facility_time_to: null,
          preferred_contact_phone: '03-3333-4444',
        }),
      }),
    );
    expect(careCaseCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          referral_source: '千代田クリニック',
          required_visit_support: expect.objectContaining({
            home_visit_intake: expect.objectContaining({
              requester: expect.objectContaining({
                organization_name: '千代田クリニック',
                phone: '03-1111-2222',
                fax: '03-1111-3333',
              }),
              reported_age: 82,
              contact_phone: '03-3333-4444',
              care_level: 'care_3',
              ent_prescription: true,
              ent_period_from: '2026-04-01',
              ent_period_to: '2026-04-30',
              home_pharmacy_add_on_2: expect.objectContaining({
                candidate: 'add_on_2_ro_candidate',
                single_building_medical_patient_count: 'two_to_nine',
                single_building_resident_count: 'ten_or_more',
                home_care_billing_category: 'medical_home_visit',
                medical_home_management_type: 'facility_medical_management',
                comprehensive_support_add_on: 'yes',
                table_8_2_applicable: 'unknown',
                medical_care_child: 'no',
                visiting_nurse_frequency: 'weekly',
                narcotic_use_categories: ['base', 'rescue'],
                aseptic_preparation_need: 'necessary',
              }),
              special_medical_procedures: ['narcotics', 'home_oxygen'],
            }),
          }),
        }),
      }),
    );
    expect(careTeamLinkCreateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            role: 'care_manager',
            name: 'ケア 山田',
            phone: '03-9999-0000',
            fax: '03-9999-1111',
          }),
        ]),
      }),
    );
    expect(notifyWebhookEventForOrgMock).toHaveBeenCalledWith('org_1', 'patient.created', {
      patientId: 'patient_new',
    });
    const webhookPayload = notifyWebhookEventForOrgMock.mock.calls[0]?.[2] ?? {};
    expect(webhookPayload).not.toHaveProperty('name');
    expect(JSON.stringify(webhookPayload)).not.toContain('訪問 花子');
  });

  it('validates and persists patient-level care team assignments on creation', async () => {
    patientFindManyMock.mockResolvedValueOnce([]);
    patientCreateMock.mockResolvedValue({
      id: 'patient_new',
      name: '訪問 花子',
    });

    const response = (await POST(
      createJsonRequest({
        name: '訪問 花子',
        name_kana: 'ホウモン ハナコ',
        birth_date: '1944-04-01',
        gender: 'female',
        primary_pharmacist_id: 'pharmacist_primary',
        backup_pharmacist_id: '',
        primary_staff_id: 'staff_primary',
        backup_staff_id: 'staff_backup',
      }),
    ))!;

    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      pharmacist_ids: ['pharmacist_primary'],
      staff_ids: ['staff_primary', 'staff_backup'],
    });
    expect(patientCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          primary_pharmacist_id: 'pharmacist_primary',
          backup_pharmacist_id: null,
          primary_staff_id: 'staff_primary',
          backup_staff_id: 'staff_backup',
        }),
      }),
    );
  });

  it('rejects patient-level care team assignments outside the organization before creating', async () => {
    validateOrgReferencesMock.mockResolvedValueOnce({
      ok: false,
      response: Response.json(
        {
          code: 'VALIDATION_ERROR',
          message: '指定されたスタッフはこの組織に所属していません',
        },
        { status: 400 },
      ),
    });

    const response = (await POST(
      createJsonRequest({
        name: '訪問 花子',
        name_kana: 'ホウモン ハナコ',
        birth_date: '1944-04-01',
        gender: 'female',
        primary_staff_id: 'outside_staff',
      }),
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '指定されたスタッフはこの組織に所属していません',
    });
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      staff_ids: ['outside_staff'],
    });
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientCreateMock).not.toHaveBeenCalled();
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
  });

  it('returns 409 before creating when a patient identity duplicate is not acknowledged', async () => {
    patientFindManyMock.mockResolvedValueOnce([
      {
        id: 'patient_existing',
        name: '訪問 花子',
        name_kana: 'ホウモン ハナコ',
        birth_date: new Date('1944-04-01'),
        gender: 'female',
      },
    ]);

    const response = (await POST(
      createJsonRequest({
        name: '訪問 花子',
        name_kana: 'ホウモン ハナコ',
        birth_date: '1944-04-01',
        gender: 'female',
      }),
    ))!;

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        duplicate_type: 'patient_identity',
        duplicates: [expect.objectContaining({ id: 'patient_existing' })],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientCreateMock).not.toHaveBeenCalled();
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
  });

  it('creates and returns a warning when an identity duplicate is acknowledged', async () => {
    patientFindManyMock.mockResolvedValueOnce([
      {
        id: 'patient_existing',
        name: '訪問 花子',
        name_kana: 'ホウモン ハナコ',
        birth_date: new Date('1944-04-01'),
        gender: 'female',
      },
    ]);
    patientCreateMock.mockResolvedValue({
      id: 'patient_new',
      name: '訪問 花子',
    });

    const response = (await POST(
      createJsonRequest({
        name: '訪問 花子',
        name_kana: 'ホウモン ハナコ',
        birth_date: '1944-04-01',
        gender: 'female',
        duplicate_acknowledged: true,
      }),
    ))!;

    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      id: 'patient_new',
      warnings: [
        {
          code: 'PATIENT_DUPLICATE_ACKNOWLEDGED',
          severity: 'warning',
        },
      ],
      metadata: {
        duplicate_acknowledged: true,
        duplicate_candidate_count: 1,
      },
    });
    expect(body.metadata).not.toHaveProperty('duplicate_candidates');
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('patient_existing');
    expect(bodyText).not.toContain('1944-04-01');
    expect(patientCreateMock).toHaveBeenCalled();
    expect(notifyWebhookEventForOrgMock).toHaveBeenCalledWith('org_1', 'patient.created', {
      patientId: 'patient_new',
    });
  });

  it('rejects malformed patient contact numbers before creating a patient', async () => {
    const response = (await POST(
      createJsonRequest({
        name: '訪問 花子',
        name_kana: 'ホウモン ハナコ',
        birth_date: '1944-04-01',
        gender: 'female',
        phone: '090-ABCD-1234',
        requester: {
          phone: '03-ABCD-2222',
        },
        intake: {
          contact_phone: '03-3333-ABCD',
          care_manager: {
            phone: 'FAX-0000',
          },
        },
      }),
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientCreateMock).not.toHaveBeenCalled();
    expect(patientSchedulePreferenceCreateMock).not.toHaveBeenCalled();
    expect(careTeamLinkCreateManyMock).not.toHaveBeenCalled();
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
  });

  it('rejects non-object request bodies before creating a patient', async () => {
    const response = (await POST(createJsonRequest(['unexpected'])))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientCreateMock).not.toHaveBeenCalled();
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before creating a patient', async () => {
    const response = (await POST(createMalformedJsonRequest()))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(assertFacilityReferenceMock).not.toHaveBeenCalled();
    expect(patientCreateMock).not.toHaveBeenCalled();
    expect(residenceCreateMock).not.toHaveBeenCalled();
    expect(contactPartyCreateManyMock).not.toHaveBeenCalled();
    expect(careCaseCreateMock).not.toHaveBeenCalled();
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
  });

  it('rejects non-object intake payloads before creating a patient', async () => {
    const response = (await POST(
      createJsonRequest({
        name: '訪問 花子',
        name_kana: 'ホウモン ハナコ',
        birth_date: '1944-04-01',
        gender: 'female',
        intake: ['unexpected'],
      }),
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientCreateMock).not.toHaveBeenCalled();
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
  });

  it.each([401, 403] as const)(
    'adds no-store headers to patient POST auth failure %s',
    async (status) => {
      const response = (await POST(createAuthFailureRequest(status, 'POST')))!;

      expect(response.status).toBe(status);
      expectSensitiveNoStore(response);
      expect(validateOrgReferencesMock).not.toHaveBeenCalled();
      expect(patientFindManyMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(patientCreateMock).not.toHaveBeenCalled();
      expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
    },
  );

  it('returns a fixed sensitive no-store 500 when patient creation fails unexpectedly', async () => {
    const rawErrorMessage = 'create patient failed for 患者A birth=1944-04-01 token=secret';
    patientFindManyMock.mockResolvedValueOnce([]);
    patientCreateMock.mockRejectedValueOnce(new Error(rawErrorMessage));

    const response = (await POST(
      createJsonRequest({
        name: '訪問 花子',
        name_kana: 'ホウモン ハナコ',
        birth_date: '1944-04-01',
        gender: 'female',
      }),
    ))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain(rawErrorMessage);
    expect(bodyText).not.toContain('患者A');
    expect(bodyText).not.toContain('token=secret');
    expect(residenceCreateMock).not.toHaveBeenCalled();
    expect(contactPartyCreateManyMock).not.toHaveBeenCalled();
    expect(patientConditionCreateManyMock).not.toHaveBeenCalled();
    expect(careCaseCreateMock).not.toHaveBeenCalled();
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
  });

  it('returns a fixed sensitive no-store 500 when patient POST auth plumbing fails', async () => {
    authPlumbingFailureRef.current = new Error(
      'auth plumbing failed for patient=患者A token=secret',
    );

    const response = (await POST(
      createJsonRequest({
        name: '訪問 花子',
        name_kana: 'ホウモン ハナコ',
        birth_date: '1944-04-01',
        gender: 'female',
      }),
    ))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain('患者A');
    expect(bodyText).not.toContain('token=secret');
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientCreateMock).not.toHaveBeenCalled();
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
  });

  it('copies facility acceptance window into schedule preferences on patient creation', async () => {
    patientFindManyMock.mockResolvedValueOnce([]);
    getFacilityVisitDefaultsMock.mockResolvedValue({
      id: 'facility_1',
      acceptance_time_from: new Date('1970-01-01T09:00:00.000Z'),
      acceptance_time_to: new Date('1970-01-01T17:00:00.000Z'),
      regular_visit_weekdays: [1, 3, 5],
    });

    const response = (await POST(
      createJsonRequest({
        name: '施設 利用者',
        name_kana: 'シセツ リヨウシャ',
        birth_date: '1945-02-03',
        gender: 'female',
        address: '東京都新宿区1-2-3',
        facility_id: 'facility_1',
      }),
    ))!;

    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(getFacilityVisitDefaultsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        patient: expect.any(Object),
        residence: expect.any(Object),
      }),
      'org_1',
      'facility_1',
    );
    expect(patientSchedulePreferenceCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          facility_time_from: new Date('1970-01-01T09:00:00.000Z'),
          facility_time_to: new Date('1970-01-01T17:00:00.000Z'),
        }),
      }),
    );
  });

  it('checks the search rate limit scoped to org+user before querying patients', async () => {
    await GET(createAuthenticatedRequest());

    expect(enforceFeatureRateLimitMock).toHaveBeenCalledWith(
      'org_1:user_1',
      '/api/patients',
      'search',
    );
  });

  it('returns the 429 response from the rate limiter without querying the database (GET)', async () => {
    const rateLimitedResponse = Response.json(
      {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'リクエストが多すぎます。しばらくしてから再度お試しください',
      },
      { status: 429, headers: { 'Retry-After': '20' } },
    );
    enforceFeatureRateLimitMock.mockResolvedValueOnce(rateLimitedResponse);

    const response = (await GET(createAuthenticatedRequest()))!;

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('20');
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(patientFindManyMock).not.toHaveBeenCalled();
  });

  it('checks the write rate limit scoped to org+user before creating a patient', async () => {
    await POST(
      createJsonRequest({
        name: '山田 花子',
        name_kana: 'ヤマダ ハナコ',
        birth_date: '1950-01-01',
        gender: 'female',
        address: '東京都新宿区1-2-3',
      }),
    );

    expect(enforceFeatureRateLimitMock).toHaveBeenCalledWith(
      'org_1:user_1',
      '/api/patients',
      'mutation',
    );
  });

  it('returns the 429 response from the rate limiter without creating a patient (POST)', async () => {
    const rateLimitedResponse = Response.json(
      {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'リクエストが多すぎます。しばらくしてから再度お試しください',
      },
      { status: 429, headers: { 'Retry-After': '5' } },
    );
    enforceFeatureRateLimitMock.mockResolvedValueOnce(rateLimitedResponse);

    const response = (await POST(
      createJsonRequest({
        name: '山田 花子',
        name_kana: 'ヤマダ ハナコ',
        birth_date: '1950-01-01',
        gender: 'female',
        address: '東京都新宿区1-2-3',
      }),
    ))!;

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('5');
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(patientCreateMock).not.toHaveBeenCalled();
  });
});
