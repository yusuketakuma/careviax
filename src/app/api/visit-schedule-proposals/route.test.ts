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
  auditLogCreateMock,
  withOrgContextMock,
  findActiveVisitConsentMock,
  findCurrentManagementPlanMock,
  notifyWorkflowMutationMock,
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
  auditLogCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  findActiveVisitConsentMock: vi.fn(),
  findCurrentManagementPlanMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
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

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { GET, POST } from './route';

function createRequest(url: string, body?: unknown) {
  return {
    url,
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' })[key] ?? null,
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
    findActiveVisitConsentMock.mockResolvedValue({
      id: 'consent_1',
      expiry_date: new Date('2027-12-31'),
    });
    findCurrentManagementPlanMock.mockResolvedValue({
      current: { id: 'plan_1', status: 'approved' },
      reviewOverdue: false,
    });
    validateOrgReferencesMock.mockResolvedValue({ ok: true });
    generateVisitScheduleProposalDraftsMock.mockResolvedValue({
      drafts: [
        {
          org_id: 'org_1',
          case_id: 'case_1',
          proposed_pharmacist_id: 'user_2',
          proposed_date: new Date('2026-04-03T00:00:00.000Z'),
        },
      ],
      diagnostics: {
        accepted: [],
        rejected: [],
      },
    });
    visitScheduleProposalCreateMock.mockResolvedValue({ id: 'proposal_2' });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitScheduleProposal: {
          updateMany: visitScheduleProposalUpdateManyMock,
          create: visitScheduleProposalCreateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('lists proposals with pharmacist metadata', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/visit-schedule-proposals?case_id=case_1'),
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
    expect(visitScheduleProposalFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            {
              OR: [
                { proposed_pharmacist_id: 'user_1' },
                { case_: { primary_pharmacist_id: 'user_1' } },
                { case_: { backup_pharmacist_id: 'user_1' } },
                { case_: { visit_schedules: { some: { pharmacist_id: 'user_1' } } } },
              ],
            },
          ],
        }),
      }),
    );
  });

  it('filters proposals by patient_id when provided', async () => {
    await GET(createRequest('http://localhost/api/visit-schedule-proposals?patient_id=patient_1'));

    expect(visitScheduleProposalFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          case_: {
            is: {
              patient_id: 'patient_1',
            },
          },
        }),
      }),
    );
  });

  it('creates proposal drafts and supersedes open proposals', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      case_id: 'case_1',
    });
    expect(careCaseFindFirstMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'case_1',
          org_id: 'org_1',
          AND: [
            {
              OR: [
                { primary_pharmacist_id: 'user_1' },
                { backup_pharmacist_id: 'user_1' },
                { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
              ],
            },
          ],
        }),
        select: { id: true },
      }),
    );
    expect(generateVisitScheduleProposalDraftsMock).toHaveBeenCalled();
    expect(visitScheduleProposalUpdateManyMock).toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).toHaveBeenCalled();
  });

  it('denies unassigned proposal generation before billing, planner, writes, audit, or notify side effects', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce(null);

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_unassigned',
        candidate_count: 1,
      }),
    ))!;

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(prescriptionIntakeFindFirstMock).not.toHaveBeenCalled();
    expect(billingCandidateFindManyMock).not.toHaveBeenCalled();
    expect(generateVisitScheduleProposalDraftsMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns planner diagnostics for rejected candidates', async () => {
    generateVisitScheduleProposalDraftsMock.mockResolvedValueOnce({
      drafts: [
        {
          org_id: 'org_1',
          case_id: 'case_1',
          proposed_pharmacist_id: 'user_2',
          proposed_date: new Date('2026-04-03T00:00:00.000Z'),
        },
      ],
      diagnostics: {
        accepted: [
          {
            pharmacist_id: 'user_2',
            pharmacist_name: '薬剤師A',
            site_id: 'site_1',
            site_name: '本店',
            proposed_date: '2026-04-03',
            travel_mode: 'DRIVE',
            route_order: 1,
            route_distance_score: 12,
            travel_summary: '実道路移動 約12分',
            assignment_mode: 'primary',
            care_relationship: 'primary',
            score: 8,
            score_breakdown: {
              geocodePenalty: 0,
              facilityBonus: 0,
              workloadPenalty: 2,
              slackPenalty: 0,
              lockPenalty: 0,
              cadencePenalty: 0,
            },
            time_window_start: new Date('1970-01-01T09:00:00.000Z'),
            time_window_end: new Date('1970-01-01T10:00:00.000Z'),
          },
        ],
        rejected: [
          {
            pharmacist_id: 'user_3',
            pharmacist_name: '薬剤師B',
            site_id: 'site_1',
            site_name: '本店',
            proposed_date: '2026-04-03',
            travel_mode: 'DRIVE',
            reason_code: 'daily_capacity',
            reason_label: '日次上限超過',
            detail: '日次上限に到達しています',
          },
        ],
      },
    });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
      }),
    ))!;

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      diagnostics: {
        rejected: [
          expect.objectContaining({
            reason_code: 'daily_capacity',
          }),
        ],
      },
    });
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
      }),
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
      }),
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
      }),
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
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(generateVisitScheduleProposalDraftsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        visitType: 'emergency',
        priority: 'emergency',
      }),
    );
  });

  it('still returns billing alerts for generated pharmacists when preferred_pharmacist_id is omitted', async () => {
    userFindFirstMock.mockResolvedValueOnce({ max_weekly_visits: 1 });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
      }),
    ))!;

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      alerts: expect.arrayContaining([
        expect.objectContaining({
          type: 'pharmacist_weekly_capacity',
          severity: 'warning',
        }),
      ]),
    });
  });
});
