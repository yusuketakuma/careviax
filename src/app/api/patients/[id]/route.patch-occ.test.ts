import {
  createPatientPatchRequest as createRequest,
  expectSensitiveNoStore,
  patientRouteMocks,
} from './route.test-support';
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  assertFacilityReferenceMock,
  careCaseFindFirstMock,
  careCaseUpdateManyMock,
  getFacilityVisitDefaultsMock,
  patientFieldRevisionCreateMock,
  patientFindFirstMock,
  patientFindManyMock,
  patientInsuranceCreateMock,
  patientInsuranceFindFirstMock,
  patientInsuranceUpdateManyMock,
  patientInsuranceUpdateMock,
  patientSchedulePreferenceUpsertMock,
  patientUpdateManyMock,
  residenceFindFirstMock,
  residenceUpdateMock,
  visitRecordFindFirstMock,
  withOrgContextMock,
} = patientRouteMocks;

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (
      handler: (
        req: NextRequest,
        ctx: Record<string, unknown>,
        routeContext: { params: Promise<{ id: string }> },
      ) => Promise<Response>,
      options?: unknown,
    ) =>
    async (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) => {
      const noStore = (response: Response) => {
        response.headers.set('Cache-Control', 'private, no-store, max-age=0');
        response.headers.set('Pragma', 'no-cache');
        return response;
      };
      try {
        const authResult = await patientRouteMocks.requireAuthContextMock(req, options);
        if ('response' in authResult) return noStore(authResult.response);
        return noStore(await handler(req, authResult.ctx, routeContext));
      } catch {
        return noStore(
          Response.json(
            { code: 'INTERNAL_ERROR', message: 'サーバー内部でエラーが発生しました' },
            { status: 500 },
          ),
        );
      }
    },
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: patientRouteMocks.validateOrgReferencesMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientRouteMocks.patientFindFirstMock,
      findMany: patientRouteMocks.patientFindManyMock,
    },
    medicationProfile: {
      findMany: patientRouteMocks.medicationProfileFindManyMock,
    },
    visitSchedule: {
      findMany: patientRouteMocks.visitScheduleFindManyMock,
      count: patientRouteMocks.visitScheduleCountMock,
    },
    visitRecord: {
      findMany: patientRouteMocks.visitRecordFindManyMock,
      findFirst: patientRouteMocks.visitRecordFindFirstMock,
    },
    careReport: {
      findMany: patientRouteMocks.careReportFindManyMock,
    },
    communicationEvent: {
      findMany: patientRouteMocks.communicationEventFindManyMock,
    },
    patientSelfReport: {
      findMany: patientRouteMocks.patientSelfReportFindManyMock,
    },
    externalAccessGrant: {
      findMany: patientRouteMocks.externalAccessGrantFindManyMock,
    },
    task: {
      findMany: patientRouteMocks.taskFindManyMock,
    },
    medicationIssue: {
      findMany: patientRouteMocks.medicationIssueFindManyMock,
    },
    inquiryRecord: {
      findMany: patientRouteMocks.inquiryRecordFindManyMock,
    },
    prescriptionIntake: {
      findMany: patientRouteMocks.prescriptionIntakeFindManyMock,
    },
    medicationCycle: {
      findMany: patientRouteMocks.medicationCycleFindManyMock,
    },
    dispenseResult: {
      findMany: patientRouteMocks.dispenseResultFindManyMock,
    },
    managementPlan: {
      findMany: patientRouteMocks.managementPlanFindManyMock,
    },
    firstVisitDocument: {
      findMany: patientRouteMocks.firstVisitDocumentFindManyMock,
    },
    conferenceNote: {
      findMany: patientRouteMocks.conferenceNoteFindManyMock,
    },
    auditLog: {
      findMany: patientRouteMocks.auditLogFindManyMock,
    },
    billingEvidence: {
      findMany: patientRouteMocks.billingEvidenceFindManyMock,
    },
    billingCandidate: {
      findMany: patientRouteMocks.billingCandidateFindManyMock,
    },
    patientLabObservation: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    user: {
      findMany: patientRouteMocks.userFindManyMock,
    },
  },
}));

vi.mock('@/server/services/communication-queue', () => ({
  listCommunicationQueue: patientRouteMocks.communicationQueueMock,
}));

vi.mock('@/server/services/billing-evidence', () => ({
  listBillingEvidenceBlockers: patientRouteMocks.billingEvidenceBlockersMock,
}));

vi.mock('@/server/services/patient-risk', () => ({
  getPatientRiskSummary: patientRouteMocks.patientRiskSummaryMock,
}));

vi.mock('@/server/services/home-care-ops', () => ({
  getPatientHomeCareFeatureSummary: patientRouteMocks.patientHomeCareFeatureSummaryMock,
}));

vi.mock('@/server/services/visit-brief', () => ({
  getPatientVisitBrief: patientRouteMocks.patientVisitBriefMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: patientRouteMocks.withOrgContextMock,
}));

vi.mock('@/lib/patient/facility-reference', () => ({
  FacilityReferenceValidationError: class FacilityReferenceValidationError extends Error {},
  FacilityUnitReferenceValidationError: class FacilityUnitReferenceValidationError extends Error {},
  assertFacilityReference: patientRouteMocks.assertFacilityReferenceMock,
  assertFacilityUnitReference: vi.fn(),
  getFacilityVisitDefaults: patientRouteMocks.getFacilityVisitDefaultsMock,
}));

import { PATCH } from './route';

describe('/api/patients/[id] PATCH optimistic concurrency', () => {
  it('updates patient master and primary residence fields', async () => {
    patientUpdateManyMock.mockResolvedValueOnce({ count: 1 });

    const response = await PATCH(
      createRequest(
        {
          name: '更新後 患者A',
          name_kana: 'コウシンゴ カンジャエー',
          birth_date: '1940-01-02',
          gender: 'female',
          phone: ' 090-1111-2222 ',
          address: '東京都千代田区1-2-3',
          building_id: 'building_1',
          facility_id: 'facility_1',
          unit_name: '301',
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const payload = await response.json();
    expect(payload.data).toEqual({
      id: 'patient_1',
      updated_at: '2026-03-30T09:00:00.000Z',
    });
    expect(patientUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'patient_1',
        org_id: 'corg1234567890123456789012',
      }),
      data: expect.objectContaining({
        name: '更新後 患者A',
        name_kana: 'コウシンゴ カンジャエー',
        birth_date: new Date('1940-01-02'),
        gender: 'female',
        phone: '090-1111-2222',
      }),
    });
    expect(residenceFindFirstMock).toHaveBeenCalledWith({
      where: { patient_id: 'patient_1', is_primary: true },
      select: {
        id: true,
        address: true,
        building_id: true,
        facility_id: true,
        facility_unit_id: true,
        unit_name: true,
      },
    });
    expect(assertFacilityReferenceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        patient: expect.any(Object),
        residence: expect.any(Object),
      }),
      'corg1234567890123456789012',
      'facility_1',
    );
    expect(residenceUpdateMock).toHaveBeenCalledWith({
      where: { id: 'residence_1' },
      data: {
        address: '東京都千代田区1-2-3',
        building_id: 'building_1',
        facility_id: 'facility_1',
        facility_unit_id: null,
        unit_name: '301',
      },
    });
    expect(getFacilityVisitDefaultsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        patient: expect.any(Object),
        residence: expect.any(Object),
        patientSchedulePreference: expect.any(Object),
      }),
      'corg1234567890123456789012',
      'facility_1',
    );
    expect(patientSchedulePreferenceUpsertMock).toHaveBeenCalledWith({
      where: {
        patient_id: 'patient_1',
      },
      create: {
        org_id: 'corg1234567890123456789012',
        patient_id: 'patient_1',
        facility_time_from: null,
        facility_time_to: null,
      },
      update: {
        facility_time_from: null,
        facility_time_to: null,
      },
    });
  });

  it('rejects stale patient master PATCH requests before writing', async () => {
    patientUpdateManyMock.mockResolvedValueOnce({ count: 0 });
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '患者A',
      birth_date: new Date('1950-01-01T00:00:00.000Z'),
      gender: 'male',
      archived_at: null,
      updated_at: new Date('2026-03-30T09:00:00.000Z'),
      cases: [],
    });

    const response = await PATCH(
      createRequest(
        {
          phone: '090-1111-2222',
          expected_updated_at: '2026-03-30T08:59:59.000Z',
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者情報が同時に更新されました。画面を再読み込みしてください',
      details: { conflict_type: 'stale_patient' },
    });
    expect(withOrgContextMock).toHaveBeenCalled();
    expect(patientUpdateManyMock).toHaveBeenCalled();
    expect(patientFieldRevisionCreateMock).not.toHaveBeenCalled();
  });

  it('does not write the matching expected_updated_at pseudo field to Patient', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '患者A',
      birth_date: new Date('1950-01-01T00:00:00.000Z'),
      gender: 'male',
      archived_at: null,
      updated_at: new Date('2026-03-30T09:00:00.000Z'),
      cases: [],
    });

    const response = await PATCH(
      createRequest(
        {
          phone: '090-1111-2222',
          expected_updated_at: '2026-03-30T09:00:00.000Z',
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(patientUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'patient_1' }),
      data: expect.objectContaining({
        phone: '090-1111-2222',
      }),
    });
    expect(patientUpdateManyMock.mock.calls[0]?.[0].data).not.toHaveProperty('expected_updated_at');
  });

  it('returns 409 before updating when PATCH changes identity into a visible duplicate', async () => {
    patientFindManyMock.mockResolvedValue([
      {
        id: 'patient_other',
        name: '重複 患者',
        name_kana: 'チョウフク カンジャ',
        birth_date: new Date('1950-01-01T00:00:00.000Z'),
        gender: 'male',
      },
    ]);

    const response = await PATCH(
      createRequest(
        {
          name: '重複 患者',
          birth_date: '1950-01-01',
          gender: 'male',
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        duplicate_type: 'patient_identity',
        duplicates: [expect.objectContaining({ id: 'patient_other' })],
      },
    });
    expect(patientFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { not: 'patient_1' },
        }),
      }),
    );
    expect(withOrgContextMock).toHaveBeenCalled();
    expect(patientUpdateManyMock).not.toHaveBeenCalled();
  });

  it('treats explicit empty-string intake with a null case pair as a write', async () => {
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = await PATCH(
      createRequest({
        care_case_id: null,
        expected_care_case_version: null,
        intake: { care_level: '' },
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    expect(response.status).toBe(200);
    expect(patientSchedulePreferenceUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ care_level: null }),
        update: expect.objectContaining({ care_level: null }),
      }),
    );
    expect(careCaseUpdateManyMock).not.toHaveBeenCalled();
  });

  it('treats explicit empty requester text and intake arrays as case-backed clear writes', async () => {
    careCaseFindFirstMock.mockResolvedValue({
      id: 'case_1',
      version: 1,
      required_visit_support: {
        home_visit_intake: {
          requester: { organization_name: '旧紹介元' },
          patient_tags: ['high-risk'],
        },
      },
    });

    const response = await PATCH(
      createRequest({
        care_case_id: 'case_1',
        expected_care_case_version: 1,
        requester: { organization_name: '' },
        intake: { patient_tags: [] },
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    expect(response.status).toBe(200);
    expect(careCaseUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          referral_source: null,
          required_visit_support: expect.objectContaining({
            home_visit_intake: expect.objectContaining({ patient_tags: [] }),
          }),
        }),
      }),
    );
  });

  it('enables enteral nutrition by relying on the stored period in the final merged intake', async () => {
    careCaseFindFirstMock.mockResolvedValue({
      id: 'case_1',
      version: 1,
      required_visit_support: {
        home_visit_intake: { ent_prescription: false, ent_period_from: '2026-04-01' },
      },
    });

    const response = await PATCH(
      createRequest({
        care_case_id: 'case_1',
        expected_care_case_version: 1,
        intake: { ent_prescription: true },
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    expect(response.status).toBe(200);
    expect(careCaseUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          required_visit_support: expect.objectContaining({
            home_visit_intake: expect.objectContaining({
              ent_prescription: true,
              ent_period_from: '2026-04-01',
            }),
          }),
        }),
      }),
    );
  });

  it.each([
    {
      current: { ent_prescription: true, ent_period_from: '2026-04-01' },
      patch: { ent_period_from: null },
      message: '在宅経管栄養を有効にする場合は期間を指定してください',
    },
    {
      current: { ent_period_from: '2026-04-02' },
      patch: { ent_period_to: '2026-04-01' },
      message: '在宅経管栄養期間の開始日は終了日以前である必要があります',
    },
    {
      current: { ent_period_to: '2026-04-01' },
      patch: { ent_period_from: '2026-04-02' },
      message: '在宅経管栄養期間の開始日は終了日以前である必要があります',
    },
  ])(
    'rejects an invalid final merged intake before writes',
    async ({ current, patch, message }) => {
      careCaseFindFirstMock.mockResolvedValue({
        id: 'case_1',
        version: 1,
        required_visit_support: { home_visit_intake: current },
      });

      const response = await PATCH(
        createRequest({
          care_case_id: 'case_1',
          expected_care_case_version: 1,
          intake: patch,
        }),
        { params: Promise.resolve({ id: 'patient_1' }) },
      );

      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toEqual({
        code: 'VALIDATION_ERROR',
        message: '入力値が不正です',
        details: { intake: [message] },
      });
      expect(withOrgContextMock).toHaveBeenCalledOnce();
      expect(patientUpdateManyMock).not.toHaveBeenCalled();
      expect(careCaseUpdateManyMock).not.toHaveBeenCalled();
      expect(patientSchedulePreferenceUpsertMock).not.toHaveBeenCalled();
    },
  );

  it('uses the canonical intake case when visit provenance points to a different case', async () => {
    careCaseFindFirstMock.mockResolvedValue({
      id: 'case_b',
      version: 1,
      required_visit_support: { home_visit_intake: { primary_disease: 'before' } },
    });
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'visit_case_a',
      schedule: { case_id: 'case_a' },
    });

    const response = await PATCH(
      createRequest({
        source_visit_record_id: 'visit_case_a',
        care_case_id: 'case_b',
        expected_care_case_version: 1,
        intake: { primary_disease: '慢性心不全' },
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    expect(response.status).toBe(200);
    expect(visitRecordFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'visit_case_a',
        org_id: 'corg1234567890123456789012',
        patient_id: 'patient_1',
      },
      select: { id: true },
    });
    expect(careCaseUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'case_b', version: 1 }) }),
    );
  });

  it('updates with a warning when PATCH duplicate identity is acknowledged', async () => {
    patientFindManyMock.mockResolvedValue([
      {
        id: 'patient_other',
        name: '重複 患者',
        name_kana: 'チョウフク カンジャ',
        birth_date: new Date('1950-01-01T00:00:00.000Z'),
        gender: 'male',
      },
    ]);

    const response = await PATCH(
      createRequest(
        {
          name: '重複 患者',
          birth_date: '1950-01-01',
          gender: 'male',
          duplicate_acknowledged: true,
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['data', 'meta']);
    expect(body).toMatchObject({
      data: expect.any(Object),
      meta: {
        warnings: [
          {
            code: 'PATIENT_DUPLICATE_ACKNOWLEDGED',
            severity: 'warning',
          },
        ],
        duplicate_candidates: [expect.objectContaining({ id: 'patient_other' })],
      },
    });
    expect(patientUpdateManyMock).toHaveBeenCalled();
  });

  it('syncs normalized insurance, intake JSON, and schedule preference fields on PATCH', async () => {
    // existing active insurance has a different number → triggers close+create
    patientInsuranceFindFirstMock.mockResolvedValue({
      id: 'insurance_current_1',
      number: 'OLD_NUM',
    });

    const response = await PATCH(
      createRequest(
        {
          medical_insurance_number: '1234567890',
          billing_support_flag: true,
          expected_updated_at: '2026-03-30T09:00:00.000Z',
          care_case_id: 'case_1',
          expected_care_case_version: 1,
          requester: {
            organization_name: '新しい紹介元',
            contact_name: '相談員 田中',
            phone: ' 03-1111-2222 ',
            fax: ' 03-1111-3333 ',
          },
          intake: {
            primary_contact_preference: 'phone',
            visit_before_contact_required: true,
            first_visit_preferred_date: '2026-04-15',
            first_visit_time_slot: 'afternoon',
            mcs_linked: true,
            care_level: 'care_3',
            adl_level: 'b',
            dementia_level: 'ii',
            contact_phone: ' 090-9999-8888 ',
            primary_disease: '慢性心不全',
            ent_prescription: true,
            ent_period_from: '2026-04-01',
            ent_period_to: '2026-04-30',
            home_pharmacy_add_on_2: {
              candidate: 'add_on_2_i_single_building_candidate',
              single_building_medical_patient_count: 'one',
              single_building_resident_count: 'one',
              home_care_billing_category: 'care_home_management',
              medical_home_management_section: 'one_i_1',
              comprehensive_support_add_on: 'no',
              table_8_3_applicable: 'yes',
              pediatric_home_care: 'no',
              weekly_visiting_nurse: 'yes',
              nursing_or_family_procedure: 'yes',
              narcotic_use_categories: ['continuous_pca'],
              aseptic_preparation_need: 'unnecessary',
            },
            infection_isolation: 'droplet',
            care_manager: {
              name: 'ケア 山田',
              phone: ' 03-9999-0000 ',
              fax: ' 03-9999-1111 ',
            },
          },
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(patientUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'patient_1' }),
      data: expect.objectContaining({
        medical_insurance_number: '1234567890',
        billing_support_flag: true,
      }),
    });
    expect(patientInsuranceFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'corg1234567890123456789012',
        patient_id: 'patient_1',
        insurance_type: 'medical',
        is_active: true,
      },
      orderBy: [{ valid_from: 'desc' }, { created_at: 'desc' }],
      select: { id: true, number: true },
    });
    // Fix #2/#3: close all active rows, then create a new one (history preserved)
    expect(patientInsuranceUpdateMock).not.toHaveBeenCalled();
    expect(patientInsuranceUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'corg1234567890123456789012',
          patient_id: 'patient_1',
          insurance_type: 'medical',
          is_active: true,
        }),
        data: expect.objectContaining({
          is_active: false,
          valid_until: expect.any(Date),
        }),
      }),
    );
    expect(patientInsuranceCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'corg1234567890123456789012',
        patient_id: 'patient_1',
        insurance_type: 'medical',
        number: '1234567890',
        valid_from: expect.any(Date),
        is_active: true,
      }),
    });
    expect(patientSchedulePreferenceUpsertMock).toHaveBeenCalledWith({
      where: {
        patient_id: 'patient_1',
      },
      create: expect.objectContaining({
        org_id: 'corg1234567890123456789012',
        patient_id: 'patient_1',
        preferred_contact_name: '相談員 田中',
        preferred_contact_phone: '090-9999-8888',
        primary_contact_preference: 'phone',
        visit_before_contact_required: true,
        first_visit_preferred_date: new Date('2026-04-15'),
        first_visit_time_slot: 'afternoon',
        mcs_linked: true,
        care_level: 'care_3',
        adl_level: 'b',
        dementia_level: 'ii',
        infection_isolation: true,
      }),
      update: expect.objectContaining({
        preferred_contact_name: '相談員 田中',
        preferred_contact_phone: '090-9999-8888',
        primary_contact_preference: 'phone',
        visit_before_contact_required: true,
        first_visit_preferred_date: new Date('2026-04-15'),
        first_visit_time_slot: 'afternoon',
        mcs_linked: true,
        care_level: 'care_3',
        adl_level: 'b',
        dementia_level: 'ii',
        infection_isolation: true,
      }),
    });
    expect(careCaseUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'case_1',
        org_id: 'corg1234567890123456789012',
        patient_id: 'patient_1',
        version: 1,
      }),
      data: {
        version: { increment: 1 },
        referral_source: '新しい紹介元',
        required_visit_support: {
          home_visit_intake: expect.objectContaining({
            requester: expect.objectContaining({
              organization_name: '新しい紹介元',
              contact_name: '相談員 田中',
              phone: '03-1111-2222',
              fax: '03-1111-3333',
            }),
            contact_phone: '090-9999-8888',
            primary_disease: '慢性心不全',
            primary_contact_preference: 'phone',
            visit_before_contact_required: true,
            first_visit_date: '2026-04-15',
            first_visit_time_slot: 'afternoon',
            care_level: 'care_3',
            adl_level: 'b',
            dementia_level: 'ii',
            mcs_linked: true,
            ent_prescription: true,
            ent_period_from: '2026-04-01',
            ent_period_to: '2026-04-30',
            home_pharmacy_add_on_2: expect.objectContaining({
              candidate: 'add_on_2_i_single_building_candidate',
              single_building_medical_patient_count: 'one',
              single_building_resident_count: 'one',
              home_care_billing_category: 'care_home_management',
              medical_home_management_section: 'one_i_1',
              comprehensive_support_add_on: 'no',
              table_8_3_applicable: 'yes',
              pediatric_home_care: 'no',
              weekly_visiting_nurse: 'yes',
              nursing_or_family_procedure: 'yes',
              narcotic_use_categories: ['continuous_pca'],
              aseptic_preparation_need: 'unnecessary',
            }),
            infection_isolation: 'droplet',
            care_manager: expect.objectContaining({
              name: 'ケア 山田',
              phone: '03-9999-0000',
              fax: '03-9999-1111',
            }),
          }),
        },
      },
    });
    expect(
      (
        careCaseUpdateManyMock.mock.calls[0][0].data.required_visit_support as Record<
          string,
          unknown
        >
      ).legacy_debug,
    ).toBeUndefined();
  });

  it('updates requester and intake fields on the latest in-org care case for org-wide roles regardless of assignment', async () => {
    careCaseFindFirstMock.mockImplementation(
      async (args: { where: { AND?: unknown }; select: unknown }) => {
        // 新ポリシー: pharmacist は組織内フルアクセス。担当割当(AND)は付与されないため、
        // org 内の最新ケース(未割当でも)が解決・更新される。
        if (args.where.AND) {
          return {
            id: 'case_assigned_old',
            version: 1,
            required_visit_support: {
              home_visit_intake: {
                requester: {
                  organization_name: '旧紹介元',
                },
              },
            },
          };
        }

        return {
          id: 'case_unassigned_latest',
          version: 1,
          required_visit_support: {
            home_visit_intake: {
              requester: {
                organization_name: '未割当紹介元',
              },
            },
          },
        };
      },
    );

    const response = await PATCH(
      createRequest(
        {
          expected_updated_at: '2026-03-30T09:00:00.000Z',
          care_case_id: 'case_unassigned_latest',
          expected_care_case_version: 1,
          requester: {
            organization_name: '新しい紹介元',
          },
          intake: {
            primary_disease: '慢性心不全',
          },
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    expect(response.status).toBe(200);
    expect(careCaseFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'corg1234567890123456789012',
        patient_id: 'patient_1',
        status: { in: ['referral_received', 'assessment', 'active', 'on_hold'] },
      },
      orderBy: [{ updated_at: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        version: true,
        required_visit_support: true,
      },
    });
    expect(careCaseUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'case_unassigned_latest',
        org_id: 'corg1234567890123456789012',
        patient_id: 'patient_1',
        version: 1,
      }),
      data: {
        version: { increment: 1 },
        referral_source: '新しい紹介元',
        required_visit_support: {
          home_visit_intake: expect.objectContaining({
            requester: expect.objectContaining({
              organization_name: '新しい紹介元',
            }),
            primary_disease: '慢性心不全',
          }),
        },
      },
    });
    expect(careCaseUpdateManyMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'case_assigned_old' },
      }),
    );
  });

  it('rebuilds intake support from an empty object when required_visit_support is malformed', async () => {
    careCaseFindFirstMock.mockResolvedValue({
      id: 'case_1',
      version: 1,
      required_visit_support: ['unexpected'],
    });

    const response = await PATCH(
      createRequest(
        {
          expected_updated_at: '2026-03-30T09:00:00.000Z',
          care_case_id: 'case_1',
          expected_care_case_version: 1,
          requester: {
            organization_name: '新しい紹介元',
          },
          intake: {
            primary_disease: '慢性心不全',
          },
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    expect(response.status).toBe(200);
    expect(careCaseUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'case_1',
        org_id: 'corg1234567890123456789012',
        patient_id: 'patient_1',
        version: 1,
      }),
      data: {
        version: { increment: 1 },
        referral_source: '新しい紹介元',
        required_visit_support: {
          home_visit_intake: expect.objectContaining({
            requester: expect.objectContaining({
              organization_name: '新しい紹介元',
            }),
            primary_disease: '慢性心不全',
          }),
        },
      },
    });
  });
});
