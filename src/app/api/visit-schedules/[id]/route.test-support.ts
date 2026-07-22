import { beforeEach, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
export const visitScheduleRouteMocks = {
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  visitScheduleTxFindFirstMock: vi.fn(),
  visitScheduleProposalFindFirstMock: vi.fn(),
  visitScheduleProposalTxFindFirstMock: vi.fn(),
  visitScheduleProposalUpdateManyMock: vi.fn(),
  visitScheduleCountMock: vi.fn(),
  visitScheduleOverrideFindManyMock: vi.fn(),
  visitScheduleOverrideUpdateManyMock: vi.fn(),
  visitScheduleUpdateManyMock: vi.fn(),
  visitScheduleUpdateMock: vi.fn(),
  visitVehicleResourceFindFirstMock: vi.fn(),
  pharmacistShiftFindFirstMock: vi.fn(),
  visitPreparationFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
  resolveOperationalTasksMock: vi.fn(),
  evaluateReadyTransitionMock: vi.fn(),
  getReadyTransitionErrorMessageMock: vi.fn(),
  sanitizeReadyTransitionDetailsMock: vi.fn((details) => ({
    readiness_blockers: details.readiness_blockers,
    onboarding_blockers: details.onboarding_blockers,
    billing_blockers: details.billing_blockers.map(
      ({ key, reason, action_label, severity }: Record<string, unknown>) => ({
        key,
        reason,
        action_label,
        severity,
      }),
    ),
  })),
  withOrgContextMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  recordPhiReadAuditForRequestMock: vi.fn(),
};

export { expectSensitiveNoStore } from '@/test/api-response-assertions';

export const EXPECTED_PATCH_GUARD = {
  id: 'schedule_1',
  org_id: 'org_1',
  version: 1,
  confirmed_at: null,
  pharmacist_id: 'user_1',
  scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
  schedule_status: 'planned',
};

export function buildSerializableConflictError() {
  return new Prisma.PrismaClientKnownRequestError('Serializable transaction conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

export function createRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/visit-schedules/schedule_1', { headers });
}

export function createPatchRequest(
  body: unknown,
  headers: Record<string, string> = { 'x-org-id': 'org_1' },
) {
  return new NextRequest('http://localhost/api/visit-schedules/schedule_1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

export function expectUtcTimeDate(value: Date, hhmm: string) {
  expect(value.toISOString()).toBe(`1970-01-01T${hhmm}:00.000Z`);
}

export function createMalformedJsonPatchRequest(
  headers: Record<string, string> = { 'x-org-id': 'org_1' },
) {
  return new NextRequest('http://localhost/api/visit-schedules/schedule_1', {
    method: 'PATCH',
    body: '{"schedule_status":',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

export function buildPatchScheduleFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'schedule_1',
    case_id: 'case_1',
    cycle_id: 'cycle_1',
    visit_type: 'regular',
    priority: 'normal',
    schedule_status: 'planned',
    scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
    time_window_start: null,
    time_window_end: null,
    route_order: 1,
    recurrence_rule: null,
    version: 1,
    confirmed_at: null,
    pharmacist_id: 'user_1',
    site_id: 'site_1',
    vehicle_resource_id: null,
    visit_record: null,
    preparation: null,
    case_: {
      primary_pharmacist_id: 'user_primary',
      backup_pharmacist_id: null,
    },
    ...overrides,
  };
}

const {
  auditLogCreateMock,
  authMock,
  careCaseFindFirstMock,
  evaluateReadyTransitionMock,
  getReadyTransitionErrorMessageMock,
  membershipFindFirstMock,
  notifyWorkflowMutationMock,
  pharmacistShiftFindFirstMock,
  resolveOperationalTasksMock,
  validateOrgReferencesMock,
  visitPreparationFindFirstMock,
  visitScheduleCountMock,
  visitScheduleFindFirstMock,
  visitScheduleFindManyMock,
  visitScheduleOverrideFindManyMock,
  visitScheduleOverrideUpdateManyMock,
  visitScheduleProposalFindFirstMock,
  visitScheduleProposalTxFindFirstMock,
  visitScheduleProposalUpdateManyMock,
  visitScheduleTxFindFirstMock,
  visitScheduleUpdateManyMock,
  visitScheduleUpdateMock,
  visitVehicleResourceFindFirstMock,
  withOrgContextMock,
} = visitScheduleRouteMocks;

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'user_1' } });
  membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
  validateOrgReferencesMock.mockResolvedValue({ ok: true, data: {} });
  notifyWorkflowMutationMock.mockResolvedValue(undefined);
  resolveOperationalTasksMock.mockResolvedValue({ count: 1 });
  evaluateReadyTransitionMock.mockResolvedValue({ ok: true });
  getReadyTransitionErrorMessageMock.mockReturnValue(
    '訪問準備に未解決の止まっている理由があるため ready へ進めません',
  );
  visitScheduleUpdateManyMock.mockResolvedValue({ count: 1 });
  visitScheduleUpdateMock.mockResolvedValue({ id: 'schedule_1', schedule_status: 'in_progress' });
  visitScheduleCountMock.mockResolvedValue(0);
  visitScheduleProposalUpdateManyMock.mockResolvedValue({ count: 1 });
  visitScheduleOverrideFindManyMock.mockResolvedValue([{ id: 'override_1' }]);
  visitScheduleOverrideUpdateManyMock.mockResolvedValue({ count: 1 });
  visitVehicleResourceFindFirstMock.mockResolvedValue({
    id: 'vehicle_1',
    site_id: 'site_1',
    label: '社用車A',
    max_stops: 8,
  });
  pharmacistShiftFindFirstMock.mockResolvedValue({
    site_id: 'site_1',
    available: true,
    available_from: new Date('1970-01-01T09:00:00.000Z'),
    available_to: new Date('1970-01-01T18:00:00.000Z'),
  });
  visitPreparationFindFirstMock.mockResolvedValue({
    medication_changes_reviewed: true,
    carry_items_confirmed: true,
    previous_issues_reviewed: true,
    route_confirmed: true,
    offline_synced: true,
  });
  withOrgContextMock.mockImplementation(async (_orgId, callback) =>
    callback({
      visitSchedule: {
        findFirst: visitScheduleTxFindFirstMock,
        findMany: visitScheduleFindManyMock,
        count: visitScheduleCountMock,
        updateMany: visitScheduleUpdateManyMock,
        update: visitScheduleUpdateMock,
      },
      visitVehicleResource: {
        findFirst: visitVehicleResourceFindFirstMock,
      },
      visitScheduleProposal: {
        findFirst: visitScheduleProposalTxFindFirstMock,
        updateMany: visitScheduleProposalUpdateManyMock,
      },
      visitScheduleOverride: {
        findMany: visitScheduleOverrideFindManyMock,
        updateMany: visitScheduleOverrideUpdateManyMock,
      },
      auditLog: {
        create: auditLogCreateMock,
      },
    }),
  );
  auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
  visitScheduleProposalFindFirstMock.mockResolvedValue(null);
  visitScheduleProposalTxFindFirstMock.mockResolvedValue(null);
  visitScheduleFindManyMock.mockResolvedValue([]);
  visitScheduleTxFindFirstMock.mockImplementation(async (args) => {
    if (args?.where?.id?.not) return null;
    return {
      id: 'schedule_1',
      case_id: 'case_1',
      site_id: 'site_1',
      visit_type: 'regular',
      priority: 'normal',
      schedule_status: 'in_progress',
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      time_window_start: null,
      time_window_end: null,
      route_order: 1,
      recurrence_rule: null,
      version: 2,
      confirmed_at: null,
      pharmacist_id: 'user_1',
      vehicle_resource_id: null,
    };
  });
  visitScheduleFindFirstMock.mockResolvedValue({
    id: 'schedule_1',
    case_id: 'case_1',
    cycle_id: 'cycle_1',
    visit_type: 'regular',
    priority: 'normal',
    schedule_status: 'planned',
    scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
    time_window_start: null,
    time_window_end: null,
    route_order: 1,
    recurrence_rule: null,
    version: 1,
    confirmed_at: null,
    pharmacist_id: 'user_1',
    site_id: 'site_1',
    vehicle_resource_id: null,
    visit_record: null,
    preparation: null,
    case_: {
      primary_pharmacist_id: 'user_primary',
      backup_pharmacist_id: null,
    },
  });
  careCaseFindFirstMock.mockResolvedValue({
    patient_id: 'patient_1',
    version: 7,
    patient: {
      scheduling_preference: null,
      residences: [{ facility: null }],
    },
  });
});
