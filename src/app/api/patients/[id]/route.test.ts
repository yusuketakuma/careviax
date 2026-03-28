import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientFindFirstMock,
  patientUpdateMock,
  residenceFindFirstMock,
  residenceUpdateMock,
  medicationProfileFindManyMock,
  visitScheduleFindManyMock,
  visitRecordFindManyMock,
  careReportFindManyMock,
  communicationEventFindManyMock,
  patientSelfReportFindManyMock,
  externalAccessGrantFindManyMock,
  taskFindManyMock,
  medicationIssueFindManyMock,
  inquiryRecordFindManyMock,
  firstVisitDocumentFindManyMock,
  billingEvidenceFindManyMock,
  billingCandidateFindManyMock,
  billingEvidenceBlockersMock,
  withOrgContextMock,
  communicationQueueMock,
  patientRiskSummaryMock,
  patientHomeCareFeatureSummaryMock,
  patientVisitBriefMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientUpdateMock: vi.fn(),
  residenceFindFirstMock: vi.fn(),
  residenceUpdateMock: vi.fn(),
  medicationProfileFindManyMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  visitRecordFindManyMock: vi.fn(),
  careReportFindManyMock: vi.fn(),
  communicationEventFindManyMock: vi.fn(),
  patientSelfReportFindManyMock: vi.fn(),
  externalAccessGrantFindManyMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  medicationIssueFindManyMock: vi.fn(),
  inquiryRecordFindManyMock: vi.fn(),
  firstVisitDocumentFindManyMock: vi.fn(),
  billingEvidenceFindManyMock: vi.fn(),
  billingCandidateFindManyMock: vi.fn(),
  billingEvidenceBlockersMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  communicationQueueMock: vi.fn(),
  patientRiskSummaryMock: vi.fn(),
  patientHomeCareFeatureSummaryMock: vi.fn(),
  patientVisitBriefMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientFindFirstMock,
    },
    medicationProfile: {
      findMany: medicationProfileFindManyMock,
    },
    visitSchedule: {
      findMany: visitScheduleFindManyMock,
    },
    visitRecord: {
      findMany: visitRecordFindManyMock,
    },
    careReport: {
      findMany: careReportFindManyMock,
    },
    communicationEvent: {
      findMany: communicationEventFindManyMock,
    },
    patientSelfReport: {
      findMany: patientSelfReportFindManyMock,
    },
    externalAccessGrant: {
      findMany: externalAccessGrantFindManyMock,
    },
    task: {
      findMany: taskFindManyMock,
    },
    medicationIssue: {
      findMany: medicationIssueFindManyMock,
    },
    inquiryRecord: {
      findMany: inquiryRecordFindManyMock,
    },
    firstVisitDocument: {
      findMany: firstVisitDocumentFindManyMock,
    },
    billingEvidence: {
      findMany: billingEvidenceFindManyMock,
    },
    billingCandidate: {
      findMany: billingCandidateFindManyMock,
    },
  },
}));

vi.mock('@/server/services/communication-queue', () => ({
  listCommunicationQueue: communicationQueueMock,
}));

vi.mock('@/server/services/billing-evidence', () => ({
  listBillingEvidenceBlockers: billingEvidenceBlockersMock,
}));

vi.mock('@/server/services/patient-risk', () => ({
  getPatientRiskSummary: patientRiskSummaryMock,
}));

vi.mock('@/server/services/home-care-ops', () => ({
  getPatientHomeCareFeatureSummary: patientHomeCareFeatureSummaryMock,
}));

vi.mock('@/server/services/visit-brief', () => ({
  getPatientVisitBrief: patientVisitBriefMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, PATCH } from './route';

function createRequest(body?: unknown, headers?: Record<string, string>) {
  return {
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/patients/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'corg1234567890123456789012',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '患者A',
      cases: [],
    });
    patientUpdateMock.mockResolvedValue({ id: 'patient_1', name: '更新後 患者A' });
    residenceFindFirstMock.mockResolvedValue({ id: 'residence_1' });
    residenceUpdateMock.mockResolvedValue({ id: 'residence_1' });
    medicationProfileFindManyMock.mockResolvedValue([]);
    visitScheduleFindManyMock.mockResolvedValue([]);
    visitRecordFindManyMock.mockResolvedValue([]);
    careReportFindManyMock.mockResolvedValue([]);
    communicationEventFindManyMock.mockResolvedValue([]);
    patientSelfReportFindManyMock.mockResolvedValue([]);
    externalAccessGrantFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    medicationIssueFindManyMock.mockResolvedValue([]);
    inquiryRecordFindManyMock.mockResolvedValue([]);
    firstVisitDocumentFindManyMock.mockResolvedValue([]);
    billingEvidenceFindManyMock.mockResolvedValue([]);
    billingCandidateFindManyMock.mockResolvedValue([]);
    billingEvidenceBlockersMock.mockResolvedValue([]);
    communicationQueueMock.mockResolvedValue({
      summary: {
        pending_count: 0,
        overdue_count: 0,
        self_reports: 0,
        callback_followups: 0,
        open_requests: 0,
        delivery_backlog: 0,
        expiring_external_shares: 0,
        unconfirmed_count: 0,
        reply_waiting_count: 0,
        failed_count: 0,
      },
      items: [],
      timeline: [],
      emergency_drafts: [],
    });
    patientRiskSummaryMock.mockResolvedValue({
      patient_id: 'patient_1',
      patient_name: '患者A',
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
    });
    patientHomeCareFeatureSummaryMock.mockResolvedValue({
      totals: { blocked: 0, attention: 0, monitoring: 0, ready: 20 },
      features: [],
    });
    patientVisitBriefMock.mockResolvedValue({
      patient: { id: 'patient_1', name: '患者A' },
      context: 'patient',
      generated_at: '2026-03-27T00:00:00.000Z',
      last_prescribed_date: '2026-03-26T00:00:00.000Z',
      medication_changes: [],
      medications: [],
      dispensing_items: [],
      delivery_status: [],
      dosage_form_support: [],
      multidisciplinary_updates: [],
      unresolved_items: [],
      must_check_today: [],
      rule_summary: {
        headline: '処方・連携情報に大きな変化はありません。',
        bullets: [],
        must_check_today: [],
        source_refs: [],
        generated_at: '2026-03-27T00:00:00.000Z',
      },
      ai_summary: {
        provider: 'rule',
        requested_provider: 'disabled',
        is_fallback: true,
        model: null,
        fallback_reason: 'provider_unavailable',
        headline: '処方・連携情報に大きな変化はありません。',
        bullets: [],
        must_check_today: [],
        source_refs: [],
        generated_at: '2026-03-27T00:00:00.000Z',
      },
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patient: {
          update: patientUpdateMock,
        },
        residence: {
          findFirst: residenceFindFirstMock,
          update: residenceUpdateMock,
          create: vi.fn(),
        },
        contactParty: {
          deleteMany: vi.fn(),
          createMany: vi.fn(),
        },
        patientCondition: {
          deleteMany: vi.fn(),
          createMany: vi.fn(),
        },
      })
    );
  });

  it('loads patient detail with expanded patient master relations', async () => {
    const response = await GET(createRequest(undefined, { 'x-org-id': 'corg1234567890123456789012' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'patient_1', org_id: 'corg1234567890123456789012' },
      include: expect.objectContaining({
        residences: true,
        contacts: true,
        consents: true,
        conditions: expect.objectContaining({
          orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
        }),
        cases: expect.objectContaining({
          include: {
            care_team_links: true,
          },
        }),
      }),
    });
    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(medicationProfileFindManyMock).toHaveBeenCalled();
    expect(externalAccessGrantFindManyMock).toHaveBeenCalled();
    expect(taskFindManyMock).toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
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
    });
    expect(patientRiskSummaryMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'corg1234567890123456789012',
      patientId: 'patient_1',
    });
    expect(patientHomeCareFeatureSummaryMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'corg1234567890123456789012',
      patientId: 'patient_1',
    });
    expect(patientVisitBriefMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'corg1234567890123456789012',
      patientId: 'patient_1',
      context: 'patient',
    });
  });

  it('includes first-visit documents with normalized emergency contacts', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '患者A',
      cases: [{ id: 'case_1' }],
    });
    firstVisitDocumentFindManyMock.mockResolvedValue([
      {
        id: 'first_visit_1',
        case_id: 'case_1',
        emergency_contacts: [
          {
            id: 'contact_1',
            name: '長男 山田',
            relation: 'child',
            phone: '090-0000-1111',
            is_primary: true,
            is_emergency_contact: true,
          },
        ],
        document_url: '/api/visit-records/record_1/pdf',
        delivered_at: new Date('2026-03-26T10:30:00.000Z'),
        delivered_to: '長男 山田',
        created_at: new Date('2026-03-26T10:00:00.000Z'),
        updated_at: new Date('2026-03-26T10:30:00.000Z'),
      },
    ]);

    const response = await GET(
      createRequest(undefined, { 'x-org-id': 'corg1234567890123456789012' }),
      { params: Promise.resolve({ id: 'patient_1' }) }
    );

    if (!response) throw new Error('response is required');
    await expect(response.json()).resolves.toMatchObject({
      first_visit_documents: [
        {
          id: 'first_visit_1',
          case_id: 'case_1',
          document_url: '/api/visit-records/record_1/pdf',
          delivered_to: '長男 山田',
          emergency_contacts: [
            {
              id: 'contact_1',
              name: '長男 山田',
              relation: 'child',
              phone: '090-0000-1111',
              is_primary: true,
              is_emergency_contact: true,
            },
          ],
        },
      ],
    });
  });

  it('updates patient master and primary residence fields', async () => {
    const response = await PATCH(
      createRequest(
        {
          name: '更新後 患者A',
          name_kana: 'コウシンゴ カンジャエー',
          birth_date: '1940-01-02',
          gender: 'female',
          phone: '090-1111-2222',
          address: '東京都千代田区1-2-3',
          building_id: 'building_1',
          unit_name: '301',
        },
        { 'x-org-id': 'corg1234567890123456789012' }
      ),
      { params: Promise.resolve({ id: 'patient_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(patientUpdateMock).toHaveBeenCalledWith({
      where: { id: 'patient_1' },
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
    });
    expect(residenceUpdateMock).toHaveBeenCalledWith({
      where: { id: 'residence_1' },
      data: {
        address: '東京都千代田区1-2-3',
        building_id: 'building_1',
        unit_name: '301',
      },
    });
  });

  it('includes inquiry history in patient timeline events', async () => {
    inquiryRecordFindManyMock.mockResolvedValue([
      {
        id: 'inquiry_1',
        reason: '相互作用',
        inquiry_to_physician: '在宅主治医',
        inquiry_content: '併用可否を確認',
        result: 'pending',
        change_detail: null,
        inquired_at: new Date('2026-03-28T09:00:00.000Z'),
        resolved_at: null,
        created_at: new Date('2026-03-28T08:50:00.000Z'),
      },
      {
        id: 'inquiry_2',
        reason: '用量疑義',
        inquiry_to_physician: '在宅主治医',
        inquiry_content: '減量で合意',
        result: 'changed',
        change_detail: '5mgへ減量',
        inquired_at: new Date('2026-03-27T09:00:00.000Z'),
        resolved_at: new Date('2026-03-27T10:00:00.000Z'),
        created_at: new Date('2026-03-27T08:50:00.000Z'),
      },
    ]);

    const response = await GET(
      createRequest(undefined, { 'x-org-id': 'corg1234567890123456789012' }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      }
    );

    if (!response) throw new Error('response is required');

    await expect(response.json()).resolves.toMatchObject({
      timeline_events: expect.arrayContaining([
        expect.objectContaining({
          event_type: 'inquiry',
          title: '疑義照会 回答待ち',
        }),
        expect.objectContaining({
          event_type: 'inquiry',
          title: '疑義照会 変更あり',
          summary: expect.stringContaining('5mgへ減量'),
        }),
      ]),
    });
  });
});
