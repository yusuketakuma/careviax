import {
  createMalformedJsonPatchRequest,
  createPatientPatchRequest as createRequest,
  createRequest as createRawRequest,
  expectSensitiveNoStore,
  patientRouteMocks,
} from './route.test-support';
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  careCaseUpdateManyMock,
  contactPartyCreateManyMock,
  getFacilityVisitDefaultsMock,
  patientFieldRevisionCreateMock,
  patientFieldRevisionUpdateManyMock,
  patientFindFirstMock,
  patientInsuranceCreateMock,
  patientInsuranceFindFirstMock,
  patientInsuranceUpdateManyMock,
  patientInsuranceUpdateMock,
  patientSchedulePreferenceFindUniqueMock,
  patientSchedulePreferenceUpsertMock,
  patientUpdateManyMock,
  requireAuthContextMock,
  taskUpsertMock,
  validateOrgReferencesMock,
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

describe('/api/patients/[id] PATCH', () => {
  it('requires the patient optimistic concurrency token before loading the patient', async () => {
    const response = await PATCH(createRawRequest({ phone: '080-1111-2222' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects a semantic no-op PATCH before loading the patient', async () => {
    const response = await PATCH(createRequest({}), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '更新対象の項目が指定されていません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects blank patient ids before parsing patch payloads or loading the patient', async () => {
    const response = await PATCH(
      createMalformedJsonPatchRequest({ 'x-org-id': 'corg1234567890123456789012' }),
      {
        params: Promise.resolve({ id: '\t\n' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientUpdateManyMock).not.toHaveBeenCalled();
    expect(patientSchedulePreferenceUpsertMock).not.toHaveBeenCalled();
    expect(careCaseUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects non-object patch payloads before loading the patient', async () => {
    const response = await PATCH(createRequest([], { 'x-org-id': 'corg1234567890123456789012' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON patch payloads before loading the patient', async () => {
    const response = await PATCH(
      createMalformedJsonPatchRequest({ 'x-org-id': 'corg1234567890123456789012' }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientUpdateManyMock).not.toHaveBeenCalled();
    expect(patientSchedulePreferenceUpsertMock).not.toHaveBeenCalled();
    expect(careCaseUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects malformed patch contact numbers before loading the patient', async () => {
    const response = await PATCH(
      createRequest(
        {
          phone: '090-ABCD-1234',
          requester: {
            phone: '03-ABCD-2222',
            fax: 'FAX-3333',
          },
          intake: {
            contact_phone: '03-4444-ABCD',
            care_manager: {
              phone: '03-9999-ABCD',
            },
          },
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientUpdateManyMock).not.toHaveBeenCalled();
    expect(patientSchedulePreferenceUpsertMock).not.toHaveBeenCalled();
    expect(careCaseUpdateManyMock).not.toHaveBeenCalled();
  });

  it('returns auth rejections with sensitive no-store headers before reading PATCH inputs', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: Response.json(
        { code: 'AUTH_FORBIDDEN', message: '患者情報の更新権限がありません' },
        { status: 403 },
      ),
    });

    const response = await PATCH(
      createMalformedJsonPatchRequest({ 'x-org-id': 'corg1234567890123456789012' }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientUpdateManyMock).not.toHaveBeenCalled();
  });

  it('returns PATCH not-found responses with sensitive no-store headers before update work', async () => {
    patientFindFirstMock.mockResolvedValueOnce(null);

    const response = await PATCH(
      createRequest({ phone: '080-1111-2222' }, { 'x-org-id': 'corg1234567890123456789012' }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者が見つかりません',
    });
    expect(withOrgContextMock).toHaveBeenCalled();
    expect(patientUpdateManyMock).not.toHaveBeenCalled();
  });

  it('returns sanitized no-store 500 responses for unexpected PATCH failures without leaking raw patient context', async () => {
    const rawErrorMessage =
      'patient update lookup failed for 山田花子 insurance=1234567890 phone=090-0000-0000';
    patientFindFirstMock.mockRejectedValueOnce(new Error(rawErrorMessage));

    const response = await PATCH(
      createRequest({ phone: '080-1111-2222' }, { 'x-org-id': 'corg1234567890123456789012' }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain(rawErrorMessage);
    expect(bodyText).not.toContain('山田花子');
    expect(bodyText).not.toContain('1234567890');
    expect(bodyText).not.toContain('090-0000-0000');
    expect(withOrgContextMock).toHaveBeenCalled();
    expect(patientUpdateManyMock).not.toHaveBeenCalled();
  });

  it('assigns the patient-level care team, normalizes empty ids to null, and validates supplied ids', async () => {
    const response = await PATCH(
      createRequest({
        primary_pharmacist_id: 'pharmacist_1',
        backup_pharmacist_id: '',
        primary_staff_id: 'staff_1',
        backup_staff_id: 'staff_2',
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    // supplied (non-empty) ids are validated as org members; empty ids are excluded
    expect(validateOrgReferencesMock).toHaveBeenCalledWith(
      'corg1234567890123456789012',
      {
        pharmacist_ids: ['pharmacist_1'],
        staff_ids: ['staff_1', 'staff_2'],
      },
      expect.any(Object),
    );
    expect(patientUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'patient_1' }),
      data: expect.objectContaining({
        primary_pharmacist_id: 'pharmacist_1',
        backup_pharmacist_id: null,
        primary_staff_id: 'staff_1',
        backup_staff_id: 'staff_2',
      }),
    });
  });

  it('rejects the care team assignment when an id is not an eligible org member', async () => {
    validateOrgReferencesMock.mockResolvedValueOnce({
      ok: false,
      response: Response.json(
        { error: '指定された薬剤師はこの組織に所属していません' },
        { status: 400 },
      ),
    });

    const response = await PATCH(
      createRequest({ primary_pharmacist_id: 'outsider', backup_staff_id: 'staff_2' }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(patientUpdateManyMock).not.toHaveBeenCalled();
  });

  it('records a basic field revision for changed fields and skips no-op fields on PATCH', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '山田 太郎',
      birth_date: new Date('1950-01-01T00:00:00.000Z'),
      gender: 'male',
      phone: '090-0000-0000',
      updated_at: new Date('2026-03-30T09:00:00.000Z'),
      cases: [],
    });

    const response = await PATCH(
      createRequest(
        { phone: '080-1111-2222', name: '山田 太郎' },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);

    // phone は変更 → 現在行クローズ + 新現在行作成
    expect(patientFieldRevisionUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'corg1234567890123456789012',
          patient_id: 'patient_1',
          field_key: 'phone',
          is_current: true,
        }),
      }),
    );
    const phoneCreate = patientFieldRevisionCreateMock.mock.calls.find(
      (call) => call[0]?.data?.field_key === 'phone',
    );
    expect(phoneCreate?.[0]?.data).toMatchObject({
      category: 'basic',
      field_key: 'phone',
      old_value: '090-0000-0000',
      new_value: '080-1111-2222',
      updated_by: 'user_1',
      is_current: true,
    });

    // name は無変更 → 偽の履歴は作られない(no-op スキップ)
    const nameCreate = patientFieldRevisionCreateMock.mock.calls.find(
      (call) => call[0]?.data?.field_key === 'name',
    );
    expect(nameCreate).toBeUndefined();
  });

  it('returns 409 for an archived patient before updating patient master data', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '山田 太郎',
      phone: '090-0000-0000',
      archived_at: new Date('2026-04-01T00:00:00.000Z'),
      cases: [],
    });

    const response = await PATCH(
      createRequest({ phone: '080-1111-2222' }, { 'x-org-id': 'corg1234567890123456789012' }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'アーカイブ中の患者は復元するまで更新できません',
    });
    expect(withOrgContextMock).toHaveBeenCalled();
    expect(patientUpdateManyMock).not.toHaveBeenCalled();
    expect(patientFieldRevisionCreateMock).not.toHaveBeenCalled();
  });

  it('records revisions with visit_record provenance when source_visit_record_id is supplied', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '山田 太郎',
      birth_date: new Date('1950-01-01T00:00:00.000Z'),
      gender: 'male',
      phone: '090-0000-0000',
      updated_at: new Date('2026-03-30T09:00:00.000Z'),
      cases: [],
    });

    const response = await PATCH(
      createRequest(
        { phone: '080-1111-2222', source_visit_record_id: 'visit_1' },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);

    const phoneCreate = patientFieldRevisionCreateMock.mock.calls.find(
      (call) => call[0]?.data?.field_key === 'phone',
    );
    expect(phoneCreate?.[0]?.data).toMatchObject({
      field_key: 'phone',
      source: 'visit_record',
      source_visit_record_id: 'visit_1',
    });
  });

  it('drops source_visit_record_id provenance when the visit record is not this patient/org', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '山田 太郎',
      birth_date: new Date('1950-01-01T00:00:00.000Z'),
      gender: 'male',
      phone: '090-0000-0000',
      updated_at: new Date('2026-03-30T09:00:00.000Z'),
      cases: [],
    });
    // 他患者/他org/不正IDは検証で見つからない
    visitRecordFindFirstMock.mockResolvedValue(null);

    const response = await PATCH(
      createRequest(
        { phone: '080-1111-2222', source_visit_record_id: 'foreign_visit' },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);

    const phoneCreate = patientFieldRevisionCreateMock.mock.calls.find(
      (call) => call[0]?.data?.field_key === 'phone',
    );
    // 不正な出所は採用せず、通常の患者詳細編集として記録する
    expect(phoneCreate?.[0]?.data).toMatchObject({
      field_key: 'phone',
      source: 'patient_detail_edit',
      source_visit_record_id: null,
    });
  });

  it('snapshots contacts into a field revision when contacts are replaced on PATCH', async () => {
    const response = await PATCH(
      createRequest(
        {
          contacts: [
            { name: '山田 花子', relation: 'child', is_primary: true, is_emergency_contact: true },
            { name: '山田 次郎', relation: 'child', is_primary: true, is_emergency_contact: false },
          ],
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);

    const contactsCreate = patientFieldRevisionCreateMock.mock.calls.find(
      (call) => call[0]?.data?.field_key === 'contacts',
    );
    expect(contactsCreate?.[0]?.data).toMatchObject({
      category: 'contacts',
      field_key: 'contacts',
    });
    expect(contactPartyCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ name: '山田 花子', is_primary: true }),
        expect.objectContaining({ name: '山田 次郎', is_primary: false }),
      ],
    });
    expect((contactsCreate?.[0]?.data?.new_value as unknown[]).length).toBe(2);
  });

  it('records a clinical field revision when care_level changes via intake', async () => {
    patientSchedulePreferenceFindUniqueMock.mockResolvedValue({
      care_level: 'care_2',
      adl_level: null,
      dementia_level: null,
      swallowing_route: null,
      infection_isolation: false,
    });

    const response = await PATCH(
      createRequest(
        {
          care_case_id: 'case_1',
          expected_care_case_version: 1,
          intake: { care_level: 'care_4' },
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);

    const careLevelCreate = patientFieldRevisionCreateMock.mock.calls.find(
      (call) => call[0]?.data?.field_key === 'care_level',
    );
    expect(careLevelCreate?.[0]?.data).toMatchObject({
      category: 'clinical',
      field_key: 'care_level',
      old_value: 'care_2',
      new_value: 'care_4',
    });

    // 介護度変更は確認タスクを自動生成する(冪等 dedupe_key)
    expect(taskUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id_dedupe_key: {
            org_id: 'corg1234567890123456789012',
            dedupe_key: 'patient-care-level-review:patient_1',
          },
        },
        create: expect.objectContaining({ task_type: 'patient_change_review' }),
      }),
    );
  });

  it('syncs facility acceptance window into patient schedule preferences on PATCH', async () => {
    getFacilityVisitDefaultsMock.mockResolvedValue({
      id: 'facility_1',
      acceptance_time_from: new Date('1970-01-01T10:00:00.000Z'),
      acceptance_time_to: new Date('1970-01-01T16:30:00.000Z'),
      regular_visit_weekdays: [2, 4],
    });

    const response = await PATCH(
      createRequest(
        {
          facility_id: 'facility_1',
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(patientSchedulePreferenceUpsertMock).toHaveBeenCalledWith({
      where: {
        patient_id: 'patient_1',
      },
      create: {
        org_id: 'corg1234567890123456789012',
        patient_id: 'patient_1',
        facility_time_from: new Date('1970-01-01T10:00:00.000Z'),
        facility_time_to: new Date('1970-01-01T16:30:00.000Z'),
      },
      update: {
        facility_time_from: new Date('1970-01-01T10:00:00.000Z'),
        facility_time_to: new Date('1970-01-01T16:30:00.000Z'),
      },
    });
  });

  it('does not recreate insurance when submitted number is identical and closes stale active duplicates', async () => {
    patientInsuranceFindFirstMock.mockResolvedValue({
      id: 'insurance_current_1',
      number: '1234567890',
    });

    const response = await PATCH(
      createRequest(
        { medical_insurance_number: '1234567890' },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(patientInsuranceUpdateMock).not.toHaveBeenCalled();
    expect(patientInsuranceUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'corg1234567890123456789012',
        patient_id: 'patient_1',
        insurance_type: 'medical',
        is_active: true,
        id: { not: 'insurance_current_1' },
      },
      data: {
        is_active: false,
        valid_until: expect.any(Date),
      },
    });
    expect(patientInsuranceCreateMock).not.toHaveBeenCalled();
  });

  it('closes active insurance with valid_until when submitted number is cleared', async () => {
    const response = await PATCH(
      createRequest({ medical_insurance_number: '' }, { 'x-org-id': 'corg1234567890123456789012' }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(patientInsuranceFindFirstMock).not.toHaveBeenCalled();
    expect(patientInsuranceUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'corg1234567890123456789012',
        patient_id: 'patient_1',
        insurance_type: 'medical',
        is_active: true,
      },
      data: {
        is_active: false,
        valid_until: expect.any(Date),
      },
    });
    expect(patientInsuranceCreateMock).not.toHaveBeenCalled();
  });

  it('maps infection_isolation false-value strings to boolean false', async () => {
    const response = await PATCH(
      createRequest(
        {
          care_case_id: 'case_1',
          expected_care_case_version: 1,
          intake: {
            infection_isolation: '不要',
          },
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(patientSchedulePreferenceUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ infection_isolation: false }),
        update: expect.objectContaining({ infection_isolation: false }),
      }),
    );
  });
});
