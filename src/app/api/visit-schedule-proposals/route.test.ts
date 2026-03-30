import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  visitScheduleProposalFindManyMock,
  userFindManyMock,
  validateOrgReferencesMock,
  generateVisitScheduleProposalDraftsMock,
  visitScheduleProposalUpdateManyMock,
  visitScheduleProposalCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  visitScheduleProposalFindManyMock: vi.fn(),
  userFindManyMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  generateVisitScheduleProposalDraftsMock: vi.fn(),
  visitScheduleProposalUpdateManyMock: vi.fn(),
  visitScheduleProposalCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
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
    },
  },
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/server/services/visit-schedule-planner', () => ({
  generateVisitScheduleProposalDrafts: generateVisitScheduleProposalDraftsMock,
}));

vi.mock('@/server/services/management-plans', () => ({
  formatVisitWorkflowGateIssues: (issues: string[]) => issues.join(','),
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
});
