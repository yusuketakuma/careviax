import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  visitScheduleProposalFindManyMock,
  userFindManyMock,
  userFindFirstMock,
  careCaseFindFirstMock,
  billingCandidateFindManyMock,
  visitScheduleCountMock,
  prescriptionIntakeFindFirstMock,
  validateOrgReferencesMock,
  generateVisitScheduleProposalDraftsMock,
  visitScheduleProposalUpdateManyMock,
  visitScheduleProposalCreateMock,
  withOrgContextMock,
  findActiveVisitConsentMock,
  findCurrentManagementPlanMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  visitScheduleProposalFindManyMock: vi.fn(),
  userFindManyMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  billingCandidateFindManyMock: vi.fn(),
  visitScheduleCountMock: vi.fn(),
  prescriptionIntakeFindFirstMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  generateVisitScheduleProposalDraftsMock: vi.fn(),
  visitScheduleProposalUpdateManyMock: vi.fn(),
  visitScheduleProposalCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  findActiveVisitConsentMock: vi.fn(),
  findCurrentManagementPlanMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    visitScheduleProposal: {
      findMany: visitScheduleProposalFindManyMock,
    },
    user: {
      findMany: userFindManyMock,
      findFirst: userFindFirstMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
    billingCandidate: {
      findMany: billingCandidateFindManyMock,
    },
    visitSchedule: {
      count: visitScheduleCountMock,
    },
    prescriptionIntake: {
      findFirst: prescriptionIntakeFindFirstMock,
    },
  },
}));

vi.mock('@/server/services/management-plans', () => ({
  formatVisitWorkflowGateIssues: (issues: string[]) => issues.join(','),
  findActiveVisitConsent: findActiveVisitConsentMock,
  findCurrentManagementPlan: findCurrentManagementPlanMock,
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/server/services/visit-schedule-planner', () => ({
  generateVisitScheduleProposalDrafts: generateVisitScheduleProposalDraftsMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

function createRequest(url: string, body?: unknown) {
  return {
    url,
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null),
    },
    nextUrl: new URL(url),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe('/api/visit-schedule-proposals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    visitScheduleProposalFindManyMock.mockResolvedValue([
      {
        id: 'proposal_1',
        proposed_pharmacist_id: 'user_2',
        case_: {
          patient: {
            residences: [],
          },
        },
        site: null,
        finalized_schedule: null,
        reschedule_source_schedule: null,
        contact_logs: [],
      },
    ]);
    userFindManyMock.mockResolvedValue([
      { id: 'user_2', name: '薬剤師A', name_kana: 'ヤクザイシエー' },
    ]);
    careCaseFindFirstMock.mockResolvedValue({
      patient_id: 'patient_1',
      patient: {
        medical_insurance_number: '12345678',
        care_insurance_number: null,
      },
    });
    billingCandidateFindManyMock.mockResolvedValue([]);
    visitScheduleCountMock.mockResolvedValue(0);
    prescriptionIntakeFindFirstMock.mockResolvedValue(null);
    userFindFirstMock.mockResolvedValue({ max_weekly_visits: 40 });
    findActiveVisitConsentMock.mockResolvedValue({ id: 'consent_1', expiry_date: new Date('2027-12-31') });
    findCurrentManagementPlanMock.mockResolvedValue({ current: { id: 'plan_1', status: 'approved' }, reviewOverdue: false });
    validateOrgReferencesMock.mockResolvedValue({ ok: true });
    generateVisitScheduleProposalDraftsMock.mockResolvedValue([
      { org_id: 'org_1', case_id: 'case_1', proposed_pharmacist_id: 'user_2' },
    ]);
    visitScheduleProposalCreateMock.mockResolvedValue({ id: 'proposal_2' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitScheduleProposal: {
          updateMany: visitScheduleProposalUpdateManyMock,
          create: visitScheduleProposalCreateMock,
        },
      }),
    );
  });

  it('lists proposals with pharmacist metadata', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/visit-schedule-proposals?case_id=case_1')
    ))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: 'proposal_1',
          proposed_pharmacist: expect.objectContaining({
            id: 'user_2',
            name: '薬剤師A',
          }),
        }),
      ],
    });
  });

  it('filters proposals by patient_id when provided', async () => {
    await GET(
      createRequest('http://localhost/api/visit-schedule-proposals?patient_id=patient_1')
    );

    expect(visitScheduleProposalFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          case_: {
            is: {
              patient_id: 'patient_1',
            },
          },
        }),
      })
    );
  });

  it('creates proposal drafts and supersedes open proposals', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
      })
    ))!;

    expect(response.status).toBe(201);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      case_id: 'case_1',
    });
    expect(generateVisitScheduleProposalDraftsMock).toHaveBeenCalled();
    expect(visitScheduleProposalUpdateManyMock).toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).toHaveBeenCalled();
  });

  it('passes locked slot constraints to the planner when provided', async () => {
    await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
        start_date: '2026-04-01',
        locked_date: '2026-04-03',
        preferred_time_from: '13:00',
        preferred_time_to: '15:00',
        preferred_pharmacist_id: 'user_2',
      })
    );

    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      case_id: 'case_1',
      pharmacist_id: 'user_2',
    });
    expect(generateVisitScheduleProposalDraftsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: 'case_1',
        startDate: new Date('2026-04-01'),
        lockedDate: new Date('2026-04-03'),
        preferredTimeFrom: '13:00',
        preferredTimeTo: '15:00',
        preferredPharmacistId: 'user_2',
      })
    );
  });

  it('blocks proposal generation when same-month billing exclusions already exist', async () => {
    billingCandidateFindManyMock.mockResolvedValueOnce([
      {
        billing_code: 'medication_management_guidance',
        billing_name: '服薬管理指導料',
      },
    ]);

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
        start_date: '2026-04-01',
      })
    ))!;

    expect(response.status).toBe(400);
    expect(generateVisitScheduleProposalDraftsMock).not.toHaveBeenCalled();
  });

  it('promotes derived emergency proposals to emergency priority when priority is omitted', async () => {
    prescriptionIntakeFindFirstMock.mockResolvedValueOnce({
      prescription_category: 'emergency',
    });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        candidate_count: 1,
      })
    ))!;

    expect(response.status).toBe(201);
    expect(generateVisitScheduleProposalDraftsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        visitType: 'emergency',
        priority: 'emergency',
      })
    );
  });
});
