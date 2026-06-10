import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  visitScheduleProposalFindManyMock,
  userFindManyMock,
  userFindFirstMock,
  careCaseFindFirstMock,
  patientInsuranceFindFirstMock,
  billingCandidateFindManyMock,
  visitScheduleCountMock,
  prescriptionIntakeFindFirstMock,
  visitVehicleResourceFindFirstMock,
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
  patientInsuranceFindFirstMock: vi.fn(),
  billingCandidateFindManyMock: vi.fn(),
  visitScheduleCountMock: vi.fn(),
  prescriptionIntakeFindFirstMock: vi.fn(),
  visitVehicleResourceFindFirstMock: vi.fn(),
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
    patientInsurance: {
      findFirst: patientInsuranceFindFirstMock,
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
    visitVehicleResource: {
      findFirst: visitVehicleResourceFindFirstMock,
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
  if (body === undefined) {
    return new NextRequest(url, {
      headers: { 'x-org-id': 'org_1' },
    });
  }
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

function createMalformedJsonPostRequest() {
  return new NextRequest('http://localhost/api/visit-schedule-proposals', {
    method: 'POST',
    body: '{"case_id":',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
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
        reject_reason: '東京都港区2-2-2 090-1234-5678 アムロジピン 処方詳細',
        case_: {
          patient: {
            residences: [],
          },
        },
        site: null,
        vehicle_resource: {
          id: 'vehicle_1',
          label: '社用車A',
          travel_mode: 'DRIVE',
          max_stops: 6,
          max_route_duration_minutes: 180,
        },
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
    patientInsuranceFindFirstMock.mockResolvedValue(null);
    billingCandidateFindManyMock.mockResolvedValue([]);
    visitScheduleCountMock.mockResolvedValue(0);
    prescriptionIntakeFindFirstMock.mockResolvedValue(null);
    visitVehicleResourceFindFirstMock.mockResolvedValue({
      id: 'vehicle_1',
      site_id: 'site_1',
      label: '社用車A',
      travel_mode: 'DRIVE',
    });
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
          site_id: 'site_1',
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
    const body = await response.json();
    expect(body).toMatchObject({
      data: [
        expect.objectContaining({
          id: 'proposal_1',
          proposed_pharmacist: expect.objectContaining({
            id: 'user_2',
            name: '薬剤師A',
          }),
          vehicle_resource: expect.objectContaining({
            id: 'vehicle_1',
            label: '社用車A',
          }),
        }),
      ],
    });
    expect(body.data[0]).not.toHaveProperty('reject_reason');
    expect(JSON.stringify(body)).not.toContain('東京都港区2-2-2');
    expect(JSON.stringify(body)).not.toContain('090-1234-5678');
    expect(JSON.stringify(body)).not.toContain('アムロジピン');
    expect(JSON.stringify(body)).not.toContain('処方詳細');
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

  it('rejects unsupported status filters before querying proposals', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/visit-schedule-proposals?status=unknown'),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'status が不正です',
    });
    expect(visitScheduleProposalFindManyMock).not.toHaveBeenCalled();
    expect(userFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects invalid proposal date filters before querying proposals', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/visit-schedule-proposals?date_from=2026-02-30'),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'date_from の日付形式が不正です（YYYY-MM-DD）',
    });
    expect(visitScheduleProposalFindManyMock).not.toHaveBeenCalled();
    expect(userFindManyMock).not.toHaveBeenCalled();
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

  it('persists selected vehicle resources on generated proposal drafts', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
        travel_mode: 'BICYCLE',
        vehicle_resource_id: 'vehicle_1',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(visitVehicleResourceFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: 'vehicle_1',
        available: true,
      },
      select: {
        id: true,
        site_id: true,
        label: true,
        travel_mode: true,
      },
    });
    expect(generateVisitScheduleProposalDraftsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        travelMode: 'DRIVE',
      }),
    );
    expect(visitScheduleProposalCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        site_id: 'site_1',
        vehicle_resource_id: 'vehicle_1',
      }),
    });
  });

  it('rejects proposal generation when the selected vehicle belongs to another draft site', async () => {
    visitVehicleResourceFindFirstMock.mockResolvedValueOnce({
      id: 'vehicle_2',
      site_id: 'site_2',
      label: '別拠点車両',
      travel_mode: 'DRIVE',
    });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
        vehicle_resource_id: 'vehicle_2',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '選択した車両リソースは訪問候補の拠点では利用できません',
    });
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects non-object generation payloads before case lookup or planner side effects', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', []),
    ))!;

    expect(response.status).toBe(400);
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
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

  it('rejects malformed JSON generation payloads before case lookup or planner side effects', async () => {
    const response = (await POST(createMalformedJsonPostRequest()))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
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

  it('rejects invalid generation start_date before case lookup or planner side effects', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        candidate_count: 1,
        start_date: '2026-02-30',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
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

  it('rejects invalid generation locked_date before case lookup or planner side effects', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        candidate_count: 1,
        locked_date: '2026-04-31',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
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

  it('rejects invalid preferred visit times before case lookup or planner side effects', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        candidate_count: 1,
        preferred_time_from: '99:99',
        preferred_time_to: 'abc',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        preferred_time_from: ['時刻形式が不正です（HH:mm）'],
        preferred_time_to: ['時刻形式が不正です（HH:mm）'],
      },
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
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

  it('rejects reversed preferred visit times before case lookup or planner side effects', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        candidate_count: 1,
        preferred_time_from: '15:00',
        preferred_time_to: '13:00',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        preferred_time_to: ['希望終了時刻は希望開始時刻より後にしてください'],
      },
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
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
          proposed_date: new Date(2026, 3, 3, 0, 0, 0),
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
    visitScheduleProposalCreateMock.mockImplementationOnce(({ data }) =>
      Promise.resolve({ id: 'proposal_2', ...data }),
    );

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
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          changes: {
            diagnostics: {
              accepted: [
                expect.objectContaining({
                  pharmacist_id: 'user_2',
                  proposed_date: '2026-04-03',
                }),
              ],
              rejected: [
                expect.objectContaining({
                  reason_code: 'daily_capacity',
                }),
              ],
            },
          },
        }),
      }),
    );
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

  it('uses active structured patient insurance when legacy patient insurance columns are empty', async () => {
    careCaseFindFirstMock.mockResolvedValue({
      patient_id: 'patient_1',
      patient: {
        medical_insurance_number: null,
        care_insurance_number: null,
      },
    });
    patientInsuranceFindFirstMock.mockImplementation(async (args: unknown) => {
      const type = (args as { where?: { insurance_type?: string } }).where?.insurance_type;
      if (type !== 'medical') return null;
      return {
        id: 'insurance_1',
        number: '12345678',
        insurance_type: 'medical',
        application_status: 'confirmed',
        public_program_code: null,
        previous_care_level: null,
        provisional_care_level: null,
        confirmed_care_level: null,
        is_active: true,
      };
    });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
        start_date: '2026-04-01',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(patientInsuranceFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
          insurance_type: 'medical',
          is_active: true,
        }),
      }),
    );
    expect(billingCandidateFindManyMock).toHaveBeenCalled();
    expect(generateVisitScheduleProposalDraftsMock).toHaveBeenCalled();
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
