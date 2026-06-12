import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withAuthContextMock,
  patientFindManyMock,
  patientCreateMock,
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
} = vi.hoisted(() => ({
  withAuthContextMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  patientCreateMock: vi.fn(),
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
      req: NextRequest & { orgId?: string; userId?: string; role?: string },
      routeContext: { params: Promise<Record<string, string>> } = { params: Promise.resolve({}) },
    ) =>
      handler(
        req,
        {
          orgId: req.orgId ?? 'org_1',
          userId: req.userId ?? 'user_1',
          role: req.role ?? 'pharmacist',
        },
        routeContext,
      );
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findMany: patientFindManyMock,
      create: patientCreateMock,
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

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/patient/facility-reference', () => ({
  FacilityReferenceValidationError: class FacilityReferenceValidationError extends Error {},
  FacilityUnitReferenceValidationError: class FacilityUnitReferenceValidationError extends Error {},
  assertFacilityReference: assertFacilityReferenceMock,
  assertFacilityUnitReference: vi.fn(),
  getFacilityVisitDefaults: getFacilityVisitDefaultsMock,
}));

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

type AuthenticatedTestRequest = NextRequest & {
  orgId: string;
  userId: string;
  role: string;
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

describe('/api/patients GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-20T12:00:00.000Z'));
    patientCreateMock.mockResolvedValue({ id: 'patient_new' });
    residenceCreateMock.mockResolvedValue({ id: 'residence_new' });
    contactPartyCreateManyMock.mockResolvedValue({ count: 1 });
    patientConditionCreateManyMock.mockResolvedValue({ count: 1 });
    patientPackagingProfileCreateMock.mockResolvedValue({ id: 'packaging_new' });
    patientSchedulePreferenceCreateMock.mockResolvedValue({ id: 'schedule_pref_new' });
    careCaseCreateMock.mockResolvedValue({ id: 'case_new' });
    careTeamLinkCreateManyMock.mockResolvedValue({ count: 2 });
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
        residences: [
          {
            address: '東京都千代田区1-1-1',
            building_id: 'facility_alpha',
            unit_name: '201',
          },
        ],
        _count: { contacts: 1 },
        contacts: [{ id: 'contact_1' }],
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
            care_team_links: [{ id: 'link_1' }],
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
    expect(patientFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          AND: [
            {
              cases: {
                some: {
                  OR: [
                    { primary_pharmacist_id: 'user_1' },
                    { backup_pharmacist_id: 'user_1' },
                    { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
                  ],
                },
              },
            },
          ],
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
        latest_case: { primary_pharmacist_name: string | null } | null;
        consent: { has_visit_medication_management: boolean };
        risk_summary: { level: 'stable' | 'watch' | 'high' };
      }>;
      summary: {
        total: number;
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
      risk_summary: {
        level: 'watch',
      },
    });
    expect(payload.summary).toMatchObject({
      total: 1,
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
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientCreateMock).not.toHaveBeenCalled();
    expect(patientSchedulePreferenceCreateMock).not.toHaveBeenCalled();
    expect(careTeamLinkCreateManyMock).not.toHaveBeenCalled();
  });

  it('rejects non-object request bodies before creating a patient', async () => {
    const response = (await POST(createJsonRequest(['unexpected'])))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before creating a patient', async () => {
    const response = (await POST(createMalformedJsonRequest()))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(assertFacilityReferenceMock).not.toHaveBeenCalled();
    expect(patientCreateMock).not.toHaveBeenCalled();
    expect(residenceCreateMock).not.toHaveBeenCalled();
    expect(contactPartyCreateManyMock).not.toHaveBeenCalled();
    expect(careCaseCreateMock).not.toHaveBeenCalled();
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
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientCreateMock).not.toHaveBeenCalled();
  });

  it('copies facility acceptance window into schedule preferences on patient creation', async () => {
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
});
