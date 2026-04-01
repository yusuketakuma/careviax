import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  getRequestAuthContextMock,
  membershipFindFirstMock,
  patientFindFirstMock,
  processHandoffExtractionMock,
  withOrgContextMock,
  visitScheduleFindFirstMock,
  careCaseFindFirstMock,
  visitRecordCreateMock,
  visitRecordFindFirstMock,
  visitScheduleUpdateMock,
  consentRecordFindFirstMock,
  medicationCycleFindFirstMock,
  medicationCycleUpdateMock,
  workflowExceptionFindFirstMock,
  workflowExceptionCreateMock,
  medicationIssueFindFirstMock,
  medicationIssueCreateMock,
  tracingReportFindFirstMock,
  tracingReportCreateMock,
  communicationRequestFindFirstMock,
  communicationRequestCreateMock,
  residualMedicationFindManyMock,
  residualMedicationDeleteManyMock,
  residualMedicationCreateMock,
  contactPartyFindManyMock,
  firstVisitDocumentFindFirstMock,
  firstVisitDocumentCreateMock,
  firstVisitDocumentUpdateMock,
  taskUpsertMock,
  billingEvidenceUpsertMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  getRequestAuthContextMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  processHandoffExtractionMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  visitRecordCreateMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
  visitScheduleUpdateMock: vi.fn(),
  consentRecordFindFirstMock: vi.fn(),
  medicationCycleFindFirstMock: vi.fn(),
  medicationCycleUpdateMock: vi.fn(),
  workflowExceptionFindFirstMock: vi.fn(),
  workflowExceptionCreateMock: vi.fn(),
  medicationIssueFindFirstMock: vi.fn(),
  medicationIssueCreateMock: vi.fn(),
  tracingReportFindFirstMock: vi.fn(),
  tracingReportCreateMock: vi.fn(),
  communicationRequestFindFirstMock: vi.fn(),
  communicationRequestCreateMock: vi.fn(),
  residualMedicationFindManyMock: vi.fn(),
  residualMedicationDeleteManyMock: vi.fn(),
  residualMedicationCreateMock: vi.fn(),
  contactPartyFindManyMock: vi.fn(),
  firstVisitDocumentFindFirstMock: vi.fn(),
  firstVisitDocumentCreateMock: vi.fn(),
  firstVisitDocumentUpdateMock: vi.fn(),
  taskUpsertMock: vi.fn(),
  billingEvidenceUpsertMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/auth/request-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/request-context')>();
  return {
    ...actual,
    getRequestAuthContext: getRequestAuthContextMock,
  };
});

vi.mock('@/server/services/billing-evidence', () => ({
  upsertBillingEvidenceForVisit: billingEvidenceUpsertMock,
}));

vi.mock('@/server/services/visit-handoff', () => ({
  processHandoffExtraction: processHandoffExtractionMock,
}));

import { POST } from './route';

function createRequest(body: unknown, headers?: Record<string, string>) {
  return {
    url: 'http://localhost/api/visit-records',
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/visit-records POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    getRequestAuthContextMock.mockReturnValue({
      userId: 'user_1',
      orgId: 'org_1',
      role: 'pharmacist',
    });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    patientFindFirstMock.mockResolvedValue({ name: '患者A' });
    processHandoffExtractionMock.mockResolvedValue({
      next_check_items: [],
      ongoing_monitoring: [],
      decision_rationale: '',
      ai_extracted: true,
      ai_confidence: 0.9,
      confirmed_by: null,
      confirmed_at: null,
      extracted_at: '2026-04-01T00:00:00Z',
    });
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'ready',
      recurrence_rule: null,
      cycle_id: 'cycle_1',
      visit_type: 'regular',
      pharmacist_id: 'user_1',
      site_id: 'site_1',
      time_window_start: null,
      time_window_end: null,
      medication_end_date: null,
      visit_deadline_date: null,
    });
    careCaseFindFirstMock.mockResolvedValue({
      patient_id: 'patient_1',
    });
    visitRecordCreateMock.mockResolvedValue({ id: 'record_1' });
    visitRecordFindFirstMock.mockResolvedValue(null);
    residualMedicationFindManyMock.mockResolvedValue([]);
    residualMedicationDeleteManyMock.mockResolvedValue({ count: 0 });
    residualMedicationCreateMock.mockResolvedValue({ id: 'residual_1' });
    contactPartyFindManyMock.mockResolvedValue([]);
    firstVisitDocumentFindFirstMock.mockResolvedValue(null);
    firstVisitDocumentCreateMock.mockResolvedValue({ id: 'first_visit_1' });
    firstVisitDocumentUpdateMock.mockResolvedValue({ id: 'first_visit_1' });
    visitScheduleUpdateMock.mockResolvedValue({ id: 'schedule_1' });
    consentRecordFindFirstMock.mockResolvedValue({ id: 'consent_1' });
    medicationCycleFindFirstMock.mockResolvedValue({
      id: 'cycle_1',
      overall_status: 'visit_ready',
    });
    medicationCycleUpdateMock.mockResolvedValue({ id: 'cycle_1' });
    workflowExceptionFindFirstMock.mockResolvedValue(null);
    workflowExceptionCreateMock.mockResolvedValue({ id: 'exception_1' });
    medicationIssueFindFirstMock.mockResolvedValue(null);
    medicationIssueCreateMock.mockResolvedValue({ id: 'issue_1' });
    tracingReportFindFirstMock.mockResolvedValue(null);
    tracingReportCreateMock.mockResolvedValue({ id: 'tracing_1' });
    communicationRequestFindFirstMock.mockResolvedValue(null);
    communicationRequestCreateMock.mockResolvedValue({ id: 'request_1' });
    taskUpsertMock.mockResolvedValue({ id: 'task_1' });
    billingEvidenceUpsertMock.mockResolvedValue({ id: 'evidence_1' });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findFirst: visitScheduleFindFirstMock,
          update: visitScheduleUpdateMock,
        },
        careCase: {
          findFirst: careCaseFindFirstMock,
        },
        patient: {
          findFirst: patientFindFirstMock,
        },
        visitRecord: {
          create: visitRecordCreateMock,
          findFirst: visitRecordFindFirstMock,
        },
        residualMedication: {
          findMany: residualMedicationFindManyMock,
          deleteMany: residualMedicationDeleteManyMock,
          create: residualMedicationCreateMock,
        },
        contactParty: {
          findMany: contactPartyFindManyMock,
        },
        consentRecord: {
          findFirst: consentRecordFindFirstMock,
        },
        medicationCycle: {
          findFirst: medicationCycleFindFirstMock,
          update: medicationCycleUpdateMock,
        },
        workflowException: {
          findFirst: workflowExceptionFindFirstMock,
          create: workflowExceptionCreateMock,
        },
        medicationIssue: {
          findFirst: medicationIssueFindFirstMock,
          create: medicationIssueCreateMock,
        },
        tracingReport: {
          findFirst: tracingReportFindFirstMock,
          create: tracingReportCreateMock,
        },
        communicationRequest: {
          findFirst: communicationRequestFindFirstMock,
          create: communicationRequestCreateMock,
        },
        firstVisitDocument: {
          findFirst: firstVisitDocumentFindFirstMock,
          create: firstVisitDocumentCreateMock,
          update: firstVisitDocumentUpdateMock,
        },
        task: {
          upsert: taskUpsertMock,
          create: taskUpsertMock,
        },
      })
    );
  });

  it('returns 400 when the request patient does not match the scheduled case', async () => {
    careCaseFindFirstMock.mockResolvedValue({
      patient_id: 'patient_2',
    });

    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'completed',
        },
        { 'x-org-id': 'org_1' }
      )
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問予定に紐づく患者と記録対象患者が一致しません',
    });
    expect(visitRecordCreateMock).not.toHaveBeenCalled();
  });

  it('marks postponed visits as postponed without advancing the visit workflow', async () => {
    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'postponed',
          postpone_reason: '発熱のため延期',
        },
        { 'x-org-id': 'org_1' }
      )
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitRecordCreateMock).toHaveBeenCalledOnce();
    expect(visitScheduleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'schedule_1' },
      data: { schedule_status: 'postponed' },
    });
    expect(consentRecordFindFirstMock).not.toHaveBeenCalled();
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    expect(medicationCycleUpdateMock).not.toHaveBeenCalled();
    expect(workflowExceptionCreateMock).not.toHaveBeenCalled();
  });

  it('auto-suggests the next visit date from recurrence rule when none is provided', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'ready',
      recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=WE',
      cycle_id: 'cycle_1',
      visit_type: 'regular',
      pharmacist_id: 'user_1',
      site_id: 'site_1',
      time_window_start: null,
      time_window_end: null,
      medication_end_date: new Date('2026-04-30T00:00:00.000Z'),
      visit_deadline_date: null,
    });

    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'completed',
        },
        { 'x-org-id': 'org_1' }
      )
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitRecordCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          next_visit_suggestion_date: new Date('2026-04-01T00:00:00.000Z'),
        }),
      })
    );
    await expect(response.json()).resolves.toMatchObject({
      suggestedSchedule: {
        suggested_date: '2026-04-01',
        auto_generated: true,
        interval_days: 6,
      },
    });
  });

  it('creates tracing follow-up work for reduction targets and raises an exception for prohibited reductions', async () => {
    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'completed',
          residual_medications: [
            {
              drug_name: 'アムロジピン錠5mg',
              drug_code: '2149001',
              remaining_quantity: 30,
              prescribed_daily_dose: 2,
              is_prohibited_reduction: false,
            },
            {
              drug_name: 'オキシコドン徐放錠',
              drug_code: '8114001',
              remaining_quantity: 14,
              prescribed_daily_dose: 1,
              is_prohibited_reduction: true,
            },
          ],
        },
        { 'x-org-id': 'org_1' }
      )
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(medicationIssueCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'アムロジピン錠5mg の残薬調整',
        category: 'adherence',
      }),
      select: { id: true },
    });
    expect(tracingReportCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        patient_id: 'patient_1',
        issue_id: 'issue_1',
        status: 'draft',
      }),
      select: { id: true },
    });
    expect(communicationRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        request_type: 'tracing_report',
        related_entity_type: 'tracing_report',
        recipient_role: 'physician',
        status: 'draft',
      }),
    });
    expect(workflowExceptionCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        exception_type: 'reduction_prohibited_drug',
        severity: 'critical',
      }),
    });
    expect(taskUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          task_type: 'tracing_report_followup',
        }),
      })
    );
    expect(taskUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          task_type: 'residual_reduction_review',
        }),
      })
    );
  });

  it('creates a first-visit document with delivery record for completed initial visits', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'ready',
      recurrence_rule: null,
      cycle_id: 'cycle_1',
      visit_type: 'initial',
      pharmacist_id: 'user_1',
      site_id: 'site_1',
      time_window_start: null,
      time_window_end: null,
      medication_end_date: null,
      visit_deadline_date: null,
    });
    contactPartyFindManyMock.mockResolvedValue([
      {
        id: 'contact_1',
        name: '長男 山田',
        relation: 'child',
        phone: '090-0000-1111',
        email: null,
        fax: null,
        organization_name: null,
        department: null,
        is_primary: true,
        is_emergency_contact: true,
      },
    ]);

    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'completed',
          receipt_person_name: '長男 山田',
          receipt_at: '2026-03-26T10:30',
        },
        { 'x-org-id': 'org_1' }
      )
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(firstVisitDocumentCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        document_url: '/api/visit-records/record_1/pdf',
        delivered_at: new Date('2026-03-26T10:30'),
        delivered_to: '長男 山田',
        emergency_contacts: [
          expect.objectContaining({
            id: 'contact_1',
            name: '長男 山田',
            relation: 'child',
            phone: '090-0000-1111',
          }),
        ],
      }),
    });
    expect(firstVisitDocumentUpdateMock).not.toHaveBeenCalled();
  });

  it('kicks off handoff extraction without blocking the save response when structured SOAP is provided', async () => {
    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'completed',
          structured_soap: {
            subjective: { symptom_checks: [] },
            objective: {
              medication_status: 'full_compliance',
              adherence_score: 3,
              side_effect_checks: [],
            },
            assessment: { problem_checks: [] },
            plan: { intervention_checks: [] },
          },
        },
        { 'x-org-id': 'org_1' }
      )
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(processHandoffExtractionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        visitRecordId: 'record_1',
        patientId: 'patient_1',
        patientName: '患者A',
        requestContext: expect.objectContaining({
          userId: 'user_1',
          orgId: 'org_1',
        }),
      })
    );
  });
});
