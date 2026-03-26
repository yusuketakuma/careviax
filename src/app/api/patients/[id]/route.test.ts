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
  billingEvidenceFindManyMock,
  billingCandidateFindManyMock,
  withOrgContextMock,
  communicationQueueMock,
  patientRiskSummaryMock,
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
  billingEvidenceFindManyMock: vi.fn(),
  billingCandidateFindManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  communicationQueueMock: vi.fn(),
  patientRiskSummaryMock: vi.fn(),
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

vi.mock('@/server/services/patient-risk', () => ({
  getPatientRiskSummary: patientRiskSummaryMock,
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
    billingEvidenceFindManyMock.mockResolvedValue([]);
    billingCandidateFindManyMock.mockResolvedValue([]);
    communicationQueueMock.mockResolvedValue({
      summary: {
        pending_count: 0,
        overdue_count: 0,
        self_reports: 0,
        callback_followups: 0,
        open_requests: 0,
        delivery_backlog: 0,
        expiring_external_shares: 0,
      },
      items: [],
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
    expect(patientRiskSummaryMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'corg1234567890123456789012',
      patientId: 'patient_1',
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
});
