import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  proposalFindFirstMock,
  proposalUpdateMock,
  proposalUpdateManyMock,
  scheduleFindFirstMock,
  scheduleUpdateManyMock,
  scheduleCreateMock,
  contactLogCreateMock,
  contactLogUpdateManyMock,
  auditLogCreateMock,
  overrideUpdateMock,
  evaluateVisitWorkflowGateMock,
  upsertOperationalTaskMock,
  resolveOperationalTasksMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  proposalFindFirstMock: vi.fn(),
  proposalUpdateMock: vi.fn(),
  proposalUpdateManyMock: vi.fn(),
  scheduleFindFirstMock: vi.fn(),
  scheduleUpdateManyMock: vi.fn(),
  scheduleCreateMock: vi.fn(),
  contactLogCreateMock: vi.fn(),
  contactLogUpdateManyMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  overrideUpdateMock: vi.fn(),
  evaluateVisitWorkflowGateMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
  resolveOperationalTasksMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitScheduleProposal: {
      findFirst: proposalFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/management-plans', () => ({
  evaluateVisitWorkflowGate: evaluateVisitWorkflowGateMock,
  formatVisitWorkflowGateIssues: (issues: string[]) => issues.join(' / '),
}));

vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
  resolveOperationalTasks: resolveOperationalTasksMock,
}));

import { PATCH } from './route';

function createRequest(body: unknown, headers?: Record<string, string>) {
  return {
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
    json: async () => body,
  } as unknown as NextRequest;
}

function buildProposal(overrides?: Record<string, unknown>) {
  return {
    id: 'proposal_1',
    org_id: 'org_1',
    case_id: 'case_1',
    cycle_id: 'cycle_1',
    site_id: 'site_1',
    visit_type: 'regular',
    priority: 'normal',
    proposal_status: 'proposed',
    patient_contact_status: 'pending',
    proposed_date: new Date('2026-03-27T00:00:00.000Z'),
    time_window_start: new Date('1970-01-01T09:00:00.000Z'),
    time_window_end: new Date('1970-01-01T10:00:00.000Z'),
    proposed_pharmacist_id: 'pharmacist_1',
    assignment_mode: 'primary',
    route_order: 1,
    medication_end_date: new Date('2026-03-31T00:00:00.000Z'),
    visit_deadline_date: new Date('2026-03-30T00:00:00.000Z'),
    escalation_reason: null,
    finalized_schedule_id: null,
    reschedule_source_schedule_id: null,
    case_: {
      patient_id: 'patient_1',
    },
    ...overrides,
  };
}

describe('/api/visit-schedule-proposals/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
      },
    });
    proposalFindFirstMock.mockResolvedValue(buildProposal());
    proposalUpdateMock.mockResolvedValue({ id: 'proposal_1' });
    proposalUpdateManyMock.mockResolvedValue({ count: 2 });
    scheduleFindFirstMock.mockResolvedValue(null);
    scheduleUpdateManyMock.mockResolvedValue({ count: 1 });
    scheduleCreateMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      cycle_id: 'cycle_1',
      site_id: 'site_1',
      visit_type: 'regular',
      priority: 'normal',
      schedule_status: 'planned',
      scheduled_date: new Date('2026-03-27T00:00:00.000Z'),
      time_window_start: new Date('1970-01-01T09:00:00.000Z'),
      time_window_end: new Date('1970-01-01T10:00:00.000Z'),
      pharmacist_id: 'pharmacist_1',
      assignment_mode: 'primary',
      route_order: 1,
      confirmed_at: new Date('2026-03-26T10:00:00.000Z'),
      confirmed_by: 'user_1',
    });
    contactLogCreateMock.mockResolvedValue({ id: 'contact_log_1' });
    contactLogUpdateManyMock.mockResolvedValue({ count: 1 });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    overrideUpdateMock.mockResolvedValue({ id: 'override_1' });
    evaluateVisitWorkflowGateMock.mockResolvedValue({
      ok: true,
      issues: [],
      consentId: 'consent_1',
      managementPlanId: 'plan_1',
    });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findFirst: scheduleFindFirstMock,
          updateMany: scheduleUpdateManyMock,
          create: scheduleCreateMock,
        },
        visitScheduleProposal: {
          update: proposalUpdateMock,
          updateMany: proposalUpdateManyMock,
        },
        visitScheduleContactLog: {
          create: contactLogCreateMock,
          updateMany: contactLogUpdateManyMock,
        },
        visitScheduleOverride: {
          update: overrideUpdateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      })
    );
  });

  it('rejects confirmation before approval and patient contact', async () => {
    const response = await PATCH(
      createRequest(
        { action: 'confirm' },
        { 'x-org-id': 'org_1' }
      ),
      { params: Promise.resolve({ id: 'proposal_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'この候補は承認後の電話確認を経てから確定してください',
    });
    expect(scheduleCreateMock).not.toHaveBeenCalled();
  });

  it('requires a confirmed phone result before finalizing the proposal', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'attempted',
      })
    );

    const response = await PATCH(
      createRequest(
        { action: 'confirm' },
        { 'x-org-id': 'org_1' }
      ),
      { params: Promise.resolve({ id: 'proposal_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '患者への電話確認結果を「確認済み」にしてから日時確定してください',
    });
    expect(scheduleCreateMock).not.toHaveBeenCalled();
  });

  it('records contact attempts and updates the proposal state', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'pending',
      })
    );

    const response = await PATCH(
      createRequest(
        {
          action: 'contact_attempt',
          outcome: 'confirmed',
          contact_name: '本人',
          note: '了承済み',
        },
        { 'x-org-id': 'org_1' }
      ),
      { params: Promise.resolve({ id: 'proposal_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(contactLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        proposal_id: 'proposal_1',
        patient_id: 'patient_1',
        outcome: 'confirmed',
        contact_name: '本人',
        note: '了承済み',
      }),
    });
    expect(proposalUpdateMock).toHaveBeenCalledWith({
      where: { id: 'proposal_1' },
      data: expect.objectContaining({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
      }),
    });
  });

  it('finalizes the proposal into a confirmed visit and supersedes sibling drafts', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
      })
    );

    const response = await PATCH(
      createRequest(
        { action: 'confirm' },
        { 'x-org-id': 'org_1' }
      ),
      { params: Promise.resolve({ id: 'proposal_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(scheduleUpdateManyMock).toHaveBeenCalledOnce();
    expect(scheduleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        case_id: 'case_1',
        pharmacist_id: 'pharmacist_1',
        schedule_status: 'planned',
        confirmed_by: 'user_1',
      }),
    });
    expect(proposalUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        org_id: 'org_1',
        case_id: 'case_1',
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
        reschedule_source_schedule_id: null,
      }),
      data: {
        proposal_status: 'superseded',
      },
    });
    expect(proposalUpdateMock).toHaveBeenCalledWith({
      where: { id: 'proposal_1' },
      data: expect.objectContaining({
        proposal_status: 'confirmed',
        patient_contact_status: 'confirmed',
        finalized_schedule_id: 'schedule_1',
      }),
    });
    expect(contactLogUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        proposal_id: 'proposal_1',
        schedule_id: null,
      },
      data: {
        schedule_id: 'schedule_1',
      },
    });
  });
});
