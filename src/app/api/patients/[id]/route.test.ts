import { createRequest, patientRouteMocks } from './route.test-support';
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  auditLogFindManyMock,
  billingEvidenceFindManyMock,
  careReportFindManyMock,
  communicationEventFindManyMock,
  communicationQueueMock,
  conferenceNoteFindManyMock,
  dispenseResultFindManyMock,
  externalAccessGrantFindManyMock,
  inquiryRecordFindManyMock,
  managementPlanFindManyMock,
  medicationProfileFindManyMock,
  patientFindFirstMock,
  patientHomeCareFeatureSummaryMock,
  patientRiskSummaryMock,
  patientUpdateManyMock,
  patientVisitBriefMock,
  prescriptionIntakeFindManyMock,
  requireAuthContextMock,
  taskFindManyMock,
  userFindManyMock,
  visitScheduleFindManyMock,
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

import { GET, PATCH } from './route';

describe('/api/patients/[id] GET', () => {
  it('separates patient detail reads from clinical patient writes at the auth boundary', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: Response.json(
        { code: 'AUTH_FORBIDDEN', message: '権限がありません' },
        { status: 403 },
      ),
    });

    await GET(createRequest(), { params: Promise.resolve({ id: 'patient_1' }) });

    expect(requireAuthContextMock).toHaveBeenLastCalledWith(expect.any(NextRequest), {
      permission: 'canViewDashboard',
      message: '患者情報の閲覧権限がありません',
    });

    requireAuthContextMock.mockResolvedValueOnce({
      response: Response.json(
        { code: 'AUTH_FORBIDDEN', message: '権限がありません' },
        { status: 403 },
      ),
    });

    await PATCH(createRequest({ phone: '080-1111-2222' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(requireAuthContextMock).toHaveBeenLastCalledWith(expect.any(NextRequest), {
      permission: 'canVisit',
      message: '患者情報の更新権限がありません',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(patientUpdateManyMock).not.toHaveBeenCalled();
  });

  it('loads patient detail through scoped RLS context without timeline-only fan-out', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '患者A',
      phone: '090-1234-5678',
      medical_insurance_number: '1234567890',
      care_insurance_number: '9988776655',
      residences: [
        {
          id: 'res_1',
          address: '東京都千代田区1-2-3',
        },
      ],
      contacts: [],
      conditions: [],
      consents: [],
      cases: [],
    });

    const response = await GET(
      createRequest(undefined, { 'x-org-id': 'corg1234567890123456789012' }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    expect(withOrgContextMock).toHaveBeenCalledWith(
      'corg1234567890123456789012',
      expect.any(Function),
      {
        requestContext: expect.objectContaining({
          orgId: 'corg1234567890123456789012',
          role: 'pharmacist',
          userId: 'user_1',
        }),
      },
    );
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'patient_1',
        org_id: 'corg1234567890123456789012',
      },
      select: expect.objectContaining({
        id: true,
        name: true,
        name_kana: true,
        phone: true,
        medical_insurance_number: true,
        care_insurance_number: true,
        residences: expect.objectContaining({
          take: 4,
          orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }, { id: 'asc' }],
          select: expect.objectContaining({
            id: true,
            address: true,
            facility_id: true,
            facility_unit_id: true,
            unit_name: true,
            is_primary: true,
          }),
        }),
        contacts: expect.objectContaining({
          take: 12,
          orderBy: [
            { is_primary: 'desc' },
            { is_emergency_contact: 'desc' },
            { created_at: 'asc' },
            { id: 'asc' },
          ],
          select: expect.objectContaining({
            id: true,
            relation: true,
            name: true,
            phone: true,
            email: true,
            fax: true,
            organization_name: true,
          }),
        }),
        consents: expect.objectContaining({
          take: 8,
          select: expect.not.objectContaining({
            document_url: true,
            document_file_id: true,
          }),
        }),
        conditions: expect.objectContaining({
          take: 12,
          orderBy: [
            { is_active: 'desc' },
            { is_primary: 'desc' },
            { noted_at: 'desc' },
            { created_at: 'desc' },
            { id: 'asc' },
          ],
          select: expect.objectContaining({
            id: true,
            condition_type: true,
            name: true,
            is_primary: true,
            is_active: true,
            noted_at: true,
            notes: true,
          }),
        }),
        cases: expect.objectContaining({
          take: 8,
          select: expect.objectContaining({
            care_team_links: expect.objectContaining({
              take: 12,
              orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }, { id: 'asc' }],
              select: expect.objectContaining({
                id: true,
                external_professional_id: true,
                role: true,
                name: true,
                organization_name: true,
                phone: true,
              }),
            }),
          }),
        }),
      }),
    });
    const patientQuery = patientFindFirstMock.mock.calls[0]?.[0] as {
      include?: unknown;
      select?: {
        residences?: unknown;
        contacts?: unknown;
        consents?: { select?: Record<string, unknown> };
        cases?: { include?: unknown };
      };
    };
    expect(patientQuery).not.toHaveProperty('include');
    expect(patientQuery.select?.residences).not.toBe(true);
    expect(patientQuery.select?.contacts).not.toBe(true);
    expect(patientQuery.select?.consents?.select).not.toHaveProperty('document_url');
    expect(patientQuery.select?.consents?.select).not.toHaveProperty('document_file_id');
    expect(patientQuery.select?.cases).not.toHaveProperty('include');
    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(medicationProfileFindManyMock).toHaveBeenCalled();
    expect(externalAccessGrantFindManyMock).toHaveBeenCalled();
    expect(taskFindManyMock).toHaveBeenCalled();
    expect(communicationEventFindManyMock).not.toHaveBeenCalled();
    expect(inquiryRecordFindManyMock).not.toHaveBeenCalled();
    expect(prescriptionIntakeFindManyMock).not.toHaveBeenCalled();
    expect(dispenseResultFindManyMock).not.toHaveBeenCalled();
    expect(managementPlanFindManyMock).not.toHaveBeenCalled();
    expect(conferenceNoteFindManyMock).not.toHaveBeenCalled();
    expect(auditLogFindManyMock).not.toHaveBeenCalled();
    expect(userFindManyMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        monthly_visit_count: 0,
        timeline_events: [],
        first_visit_documents: [],
        home_care_feature_summary: {
          totals: {
            blocked: 0,
            attention: 0,
            monitoring: 0,
            ready: 20,
          },
        },
        visit_brief: {
          context: 'patient',
          ai_summary: {
            provider: 'rule',
          },
        },
      },
    });
    expect(patientRiskSummaryMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'corg1234567890123456789012',
      patientId: 'patient_1',
      caseIds: [],
    });
    expect(patientHomeCareFeatureSummaryMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'corg1234567890123456789012',
      patientId: 'patient_1',
    });
    expect(communicationQueueMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'corg1234567890123456789012',
      patientId: 'patient_1',
      caseIds: [],
      limit: 6,
    });
    expect(patientVisitBriefMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'corg1234567890123456789012',
      patientId: 'patient_1',
      context: 'patient',
      caseIds: [],
      role: 'pharmacist',
      userId: 'user_1',
      billingContext: {
        visitRecordIds: [],
        cycleIds: [],
        blockers: [],
      },
    });
  });

  it('does not load related PHI when the scoped patient lookup fails', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(medicationProfileFindManyMock).not.toHaveBeenCalled();
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
    expect(careReportFindManyMock).not.toHaveBeenCalled();
    expect(billingEvidenceFindManyMock).not.toHaveBeenCalled();
  });

  it('projects care report PDF presence without exposing storage references', async () => {
    careReportFindManyMock.mockResolvedValue([
      {
        id: 'report_without_pdf',
        report_type: 'care_manager_report',
        status: 'sent',
        pdf_url: null,
        created_by: 'user_1',
        created_at: new Date('2026-06-10T00:00:00.000Z'),
        delivery_records: [],
      },
      {
        id: 'report_with_pdf',
        report_type: 'physician_report',
        status: 'confirmed',
        pdf_url: '/api/files/file_1/download',
        created_by: 'user_1',
        created_at: new Date('2026-06-09T00:00:00.000Z'),
        delivery_records: [],
      },
    ]);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response.status).toBe(200);
    expect(careReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'corg1234567890123456789012',
          patient_id: 'patient_1',
        }),
        select: expect.objectContaining({ pdf_url: true }),
      }),
    );
    const payload = await response.json();
    expect(payload.data.care_reports).toEqual([
      expect.objectContaining({ id: 'report_without_pdf', has_pdf: false }),
      expect.objectContaining({ id: 'report_with_pdf', has_pdf: true }),
    ]);
    expect(JSON.stringify(payload.data.care_reports)).not.toContain('pdf_url');
    expect(JSON.stringify(payload.data.care_reports)).not.toContain('/api/files/');
  });

  it('rejects blank patient ids before loading patient detail', async () => {
    const response = await GET(
      createRequest(undefined, { 'x-org-id': 'corg1234567890123456789012' }),
      {
        params: Promise.resolve({ id: '   ' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(medicationProfileFindManyMock).not.toHaveBeenCalled();
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
    expect(careReportFindManyMock).not.toHaveBeenCalled();
    expect(patientRiskSummaryMock).not.toHaveBeenCalled();
    expect(communicationQueueMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when patient detail loading fails unexpectedly', async () => {
    patientFindFirstMock.mockRejectedValueOnce(
      new Error('患者 山田花子 保険番号 1234567890 raw medication detail'),
    );

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');

    const json = await response.json();
    expect(json).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(json)).not.toContain('山田花子');
    expect(JSON.stringify(json)).not.toContain('1234567890');
    expect(JSON.stringify(json)).not.toContain('raw medication detail');
  });
});
