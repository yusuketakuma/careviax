import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const {
  authMock,
  membershipFindFirstMock,
  visitScheduleFindFirstMock,
  visitScheduleTxFindFirstMock,
  visitScheduleProposalFindFirstMock,
  visitScheduleProposalTxFindFirstMock,
  visitScheduleProposalUpdateManyMock,
  visitScheduleCountMock,
  visitScheduleOverrideFindManyMock,
  visitScheduleOverrideUpdateManyMock,
  visitScheduleUpdateManyMock,
  visitScheduleUpdateMock,
  visitVehicleResourceFindFirstMock,
  pharmacistShiftFindFirstMock,
  visitPreparationFindFirstMock,
  careCaseFindFirstMock,
  validateOrgReferencesMock,
  notifyWorkflowMutationMock,
  evaluateReadyTransitionMock,
  getReadyTransitionErrorMessageMock,
  sanitizeReadyTransitionDetailsMock,
  withOrgContextMock,
  auditLogCreateMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
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
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    visitSchedule: {
      findFirst: visitScheduleFindFirstMock,
      count: visitScheduleCountMock,
    },
    visitScheduleProposal: {
      findFirst: visitScheduleProposalFindFirstMock,
    },
    visitVehicleResource: {
      findFirst: visitVehicleResourceFindFirstMock,
    },
    visitPreparation: {
      findFirst: visitPreparationFindFirstMock,
    },
    pharmacistShift: {
      findFirst: pharmacistShiftFindFirstMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

vi.mock('@/server/services/visit-preparation-readiness', () => ({
  evaluateVisitScheduleReadyTransition: evaluateReadyTransitionMock,
  getVisitReadyTransitionErrorMessage: getReadyTransitionErrorMessageMock,
  sanitizeVisitReadyTransitionDetails: sanitizeReadyTransitionDetailsMock,
}));

import { DELETE, GET, PATCH } from './route';

const EXPECTED_PATCH_GUARD = {
  id: 'schedule_1',
  org_id: 'org_1',
  version: 1,
  confirmed_at: null,
  pharmacist_id: 'user_1',
  scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
  schedule_status: 'planned',
};

function buildSerializableConflictError() {
  return new Prisma.PrismaClientKnownRequestError('Serializable transaction conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

function createRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/visit-schedules/schedule_1', { headers });
}

function createPatchRequest(
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

function expectUtcTimeDate(value: Date, hhmm: string) {
  expect(value.toISOString()).toBe(`1970-01-01T${hhmm}:00.000Z`);
}

function createMalformedJsonPatchRequest(
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

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/visit-schedules/[id] GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    validateOrgReferencesMock.mockResolvedValue({ ok: true, data: {} });
    notifyWorkflowMutationMock.mockResolvedValue(undefined);
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
      patient: {
        scheduling_preference: null,
        residences: [{ facility: null }],
      },
    });
  });

  it('returns the patient_id derived from the scheduled case', async () => {
    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      id: 'schedule_1',
      case_id: 'case_1',
      cycle_id: 'cycle_1',
      patient_id: 'patient_1',
    });
  });

  it('rejects blank schedule ids before loading schedule details', async () => {
    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問予定IDが不正です',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
  });

  it('allows an org-wide pharmacist to read a schedule regardless of assignment', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      cycle_id: 'cycle_1',
      visit_type: 'regular',
      scheduled_date: '2026-03-26',
      confirmed_at: null,
      pharmacist_id: 'user_other',
      visit_record: null,
      preparation: null,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(careCaseFindFirstMock).toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when schedule detail lookup fails unexpectedly', async () => {
    visitScheduleFindFirstMock.mockRejectedValueOnce(
      new Error('患者 山田花子 東京都千代田区1-1-1 訪問予定 raw schedule detail'),
    );

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田花子');
    expect(JSON.stringify(body)).not.toContain('東京都千代田区1-1-1');
    expect(JSON.stringify(body)).not.toContain('raw schedule detail');
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
  });

  it('allows an org-wide pharmacist to patch a schedule regardless of assignment', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      site_id: 'site_1',
      schedule_status: 'planned',
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      time_window_start: null,
      time_window_end: null,
      confirmed_at: null,
      pharmacist_id: 'user_other',
      vehicle_resource_id: null,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await PATCH(createPatchRequest({ schedule_status: 'in_progress' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(validateOrgReferencesMock).toHaveBeenCalled();
  });

  it('evaluates ready blockers for an org-wide pharmacist regardless of assignment', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      site_id: 'site_1',
      schedule_status: 'planned',
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      time_window_start: null,
      time_window_end: null,
      confirmed_at: null,
      pharmacist_id: 'user_other',
      vehicle_resource_id: null,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await PATCH(createPatchRequest({ schedule_status: 'ready' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(evaluateReadyTransitionMock).toHaveBeenCalled();
    expect(validateOrgReferencesMock).toHaveBeenCalled();
  });

  it('allows an assigned pharmacist to patch a schedule', async () => {
    const response = await PATCH(createPatchRequest({ schedule_status: 'in_progress' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: EXPECTED_PATCH_GUARD,
        data: expect.objectContaining({
          schedule_status: 'in_progress',
          version: { increment: 1 },
        }),
      }),
    );
    expect(pharmacistShiftFindFirstMock).not.toHaveBeenCalled();
  });

  it('stores patched time windows as UTC @db.Time sentinel dates', async () => {
    visitScheduleTxFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      site_id: 'site_1',
      visit_type: 'regular',
      priority: 'normal',
      schedule_status: 'planned',
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      time_window_start: new Date(Date.UTC(1970, 0, 1, 9, 30)),
      time_window_end: new Date(Date.UTC(1970, 0, 1, 10, 30)),
      route_order: 1,
      recurrence_rule: null,
      version: 2,
      confirmed_at: null,
      pharmacist_id: 'user_1',
      vehicle_resource_id: null,
    });

    const response = await PATCH(
      createPatchRequest({
        time_window_start: '09:30',
        time_window_end: '10:30',
      }),
      {
        params: Promise.resolve({ id: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const updated = visitScheduleUpdateManyMock.mock.calls[0][0].data;
    expectUtcTimeDate(updated.time_window_start, '09:30');
    expectUtcTimeDate(updated.time_window_end, '10:30');
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'visit_schedule_updated',
        target_type: 'VisitSchedule',
        target_id: 'schedule_1',
        changes: expect.objectContaining({
          timeWindowStartFrom: null,
          timeWindowStartTo: '09:30',
          timeWindowEndFrom: null,
          timeWindowEndTo: '10:30',
        }),
      }),
    });
  });

  it.each([
    {
      payload: { time_window_start: '09:30' },
      message: '終了時刻も入力してください',
      details: { time_window_end: ['終了時刻も入力してください'] },
    },
    {
      payload: { time_window_end: '10:30' },
      message: '開始時刻も入力してください',
      details: { time_window_start: ['開始時刻も入力してください'] },
    },
  ])('rejects target time windows with only one side before mutation', async (caseItem) => {
    const response = await PATCH(createPatchRequest(caseItem.payload), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: caseItem.message,
      details: caseItem.details,
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('allows unrelated status updates on legacy one-sided time windows', async () => {
    const legacyStart = new Date(Date.UTC(1970, 0, 1, 9, 0));
    visitScheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      cycle_id: 'cycle_1',
      visit_type: 'regular',
      priority: 'normal',
      schedule_status: 'planned',
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      time_window_start: legacyStart,
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
    visitScheduleTxFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      site_id: 'site_1',
      visit_type: 'regular',
      priority: 'normal',
      schedule_status: 'in_progress',
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      time_window_start: legacyStart,
      time_window_end: null,
      route_order: 1,
      recurrence_rule: null,
      version: 2,
      confirmed_at: null,
      pharmacist_id: 'user_1',
      vehicle_resource_id: null,
    });

    const response = await PATCH(createPatchRequest({ schedule_status: 'in_progress' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitScheduleUpdateManyMock).toHaveBeenCalled();
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'visit_schedule_updated',
        changes: {
          scheduleStatusFrom: 'planned',
          scheduleStatusTo: 'in_progress',
        },
      }),
    });
  });

  it('does not update, audit, or notify when a patch has no effective changes', async () => {
    const response = await PATCH(createPatchRequest({ schedule_status: 'planned' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects target time windows that become reversed after merging existing values', async () => {
    visitScheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      cycle_id: 'cycle_1',
      visit_type: 'regular',
      priority: 'normal',
      schedule_status: 'planned',
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      time_window_start: new Date(Date.UTC(1970, 0, 1, 11, 0)),
      time_window_end: new Date(Date.UTC(1970, 0, 1, 12, 0)),
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

    const response = await PATCH(
      createPatchRequest({
        time_window_end: '10:30',
      }),
      {
        params: Promise.resolve({ id: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '終了時刻は開始時刻より後にしてください',
      details: {
        time_window_end: ['終了時刻は開始時刻より後にしてください'],
      },
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('allows ready status only after the server-side readiness gate passes', async () => {
    const response = await PATCH(createPatchRequest({ schedule_status: 'ready' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(evaluateReadyTransitionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        visitSchedule: expect.objectContaining({
          updateMany: visitScheduleUpdateManyMock,
          update: visitScheduleUpdateMock,
        }),
      }),
      {
        orgId: 'org_1',
        scheduleId: 'schedule_1',
      },
    );
    expect(evaluateReadyTransitionMock.mock.invocationCallOrder[0]).toBeLessThan(
      visitScheduleUpdateManyMock.mock.invocationCallOrder[0],
    );
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: EXPECTED_PATCH_GUARD,
        data: expect.objectContaining({
          schedule_status: 'ready',
          pre_visit_checklist_completed: true,
          version: { increment: 1 },
        }),
      }),
    );
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'visit_schedules_update', schedule_id: 'schedule_1' },
    });
  });

  it('rejects ready status when server-side readiness blockers remain', async () => {
    const details = {
      readiness_blockers: [],
      onboarding_blockers: [{ key: 'management_plan_approved', label: '管理計画未承認' }],
      billing_blockers: [
        {
          evidence_id: 'billing_1',
          visit_record_id: 'visit_record_1',
          key: 'missing_management_plan',
          reason: '算定根拠が未確認',
          action_href: '/billing',
          action_label: '算定根拠を確認',
          severity: 'high',
        },
      ],
    };
    evaluateReadyTransitionMock.mockResolvedValueOnce({ ok: false, details });

    const response = await PATCH(createPatchRequest({ schedule_status: 'ready' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問準備に未解決の止まっている理由があるため ready へ進めません',
      details: {
        readiness_blockers: [],
        onboarding_blockers: [{ key: 'management_plan_approved', label: '管理計画未承認' }],
        billing_blockers: [
          {
            key: 'missing_management_plan',
            reason: '算定根拠が未確認',
            action_label: '算定根拠を確認',
            severity: 'high',
          },
        ],
      },
    });
    expect(body.details.billing_blockers[0]).not.toHaveProperty('evidence_id');
    expect(body.details.billing_blockers[0]).not.toHaveProperty('visit_record_id');
    expect(body.details.billing_blockers[0]).not.toHaveProperty('action_href');
    expect(getReadyTransitionErrorMessageMock).toHaveBeenCalledWith(details);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {});
    expect(withOrgContextMock).toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it.each(['departed', 'in_progress', 'completed'] as const)(
    'rejects %s status when server-side readiness blockers remain',
    async (scheduleStatus) => {
      const details = {
        readiness_blockers: ['オフライン同期確認'],
        onboarding_blockers: [],
        billing_blockers: [],
      };
      evaluateReadyTransitionMock.mockResolvedValueOnce({ ok: false, details });
      getReadyTransitionErrorMessageMock.mockReturnValueOnce(
        '訪問準備チェックリストが未完了のため ready へ進めません',
      );

      const response = await PATCH(createPatchRequest({ schedule_status: scheduleStatus }), {
        params: Promise.resolve({ id: 'schedule_1' }),
      });

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '訪問準備チェックリストが未完了のため ready へ進めません',
        details,
      });
      expect(evaluateReadyTransitionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          visitSchedule: expect.objectContaining({
            updateMany: visitScheduleUpdateManyMock,
            update: visitScheduleUpdateMock,
          }),
        }),
        { orgId: 'org_1', scheduleId: 'schedule_1' },
      );
      expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
      expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
    },
  );

  it('rejects ready-gated status changes when the case is changed in the same patch', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await PATCH(
      createPatchRequest({ schedule_status: 'ready', case_id: 'case_2' }),
      {
        params: Promise.resolve({ id: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'ready 系ステータスへ進める更新ではケース変更を同時に行えません',
    });
    expect(evaluateReadyTransitionMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects case changes while the current schedule is already ready-gated', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    visitScheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'ready',
      confirmed_at: null,
      pharmacist_id: 'user_1',
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await PATCH(createPatchRequest({ case_id: 'case_2' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'ready 系ステータスへ進める更新ではケース変更を同時に行えません',
    });
    expect(evaluateReadyTransitionMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects case changes from ready-gated schedules even when status is downgraded', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    visitScheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'ready',
      confirmed_at: null,
      pharmacist_id: 'user_1',
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await PATCH(
      createPatchRequest({ schedule_status: 'planned', case_id: 'case_2' }),
      {
        params: Promise.resolve({ id: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'ready 系ステータスへ進める更新ではケース変更を同時に行えません',
    });
    expect(evaluateReadyTransitionMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects visit-date changes in the same patch as a ready-gated status transition', async () => {
    const response = await PATCH(
      createPatchRequest({ schedule_status: 'ready', scheduled_date: '2026-05-01' }),
      {
        params: Promise.resolve({ id: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'ready 系ステータスへ進める更新では訪問日変更を同時に行えません',
    });
    expect(evaluateReadyTransitionMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects visit-date changes while the current schedule is already ready-gated', async () => {
    visitScheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'in_progress',
      confirmed_at: null,
      pharmacist_id: 'user_1',
      site_id: 'site_1',
      vehicle_resource_id: null,
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      time_window_start: null,
      time_window_end: null,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await PATCH(createPatchRequest({ scheduled_date: '2026-05-01' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'ready 系ステータスへ進める更新では訪問日変更を同時に行えません',
    });
    expect(evaluateReadyTransitionMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects visit-date changes from ready-gated schedules even when status is downgraded', async () => {
    visitScheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'departed',
      confirmed_at: null,
      pharmacist_id: 'user_1',
      site_id: 'site_1',
      vehicle_resource_id: null,
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      time_window_start: null,
      time_window_end: null,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await PATCH(
      createPatchRequest({ schedule_status: 'planned', scheduled_date: '2026-05-01' }),
      {
        params: Promise.resolve({ id: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'ready 系ステータスへ進める更新では訪問日変更を同時に行えません',
    });
    expect(evaluateReadyTransitionMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects moving terminal schedules back to ready-gated statuses', async () => {
    visitScheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'completed',
      confirmed_at: null,
      pharmacist_id: 'user_1',
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await PATCH(createPatchRequest({ schedule_status: 'ready' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '終了済みまたは中止済みの訪問予定は ready 系ステータスへ戻せません',
    });
    expect(evaluateReadyTransitionMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('assigns selected vehicle resources during schedule PATCH', async () => {
    const response = await PATCH(createPatchRequest({ vehicle_resource_id: 'vehicle_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
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
        max_stops: true,
      },
    });
    expect(visitScheduleCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { not: 'schedule_1' },
        vehicle_resource_id: 'vehicle_1',
        scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
        schedule_status: {
          notIn: ['cancelled', 'rescheduled'],
        },
      },
    });
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          vehicle_resource_id: 'vehicle_1',
        }),
      }),
    );
  });

  it('rejects vehicle assignment when the vehicle is full across other pharmacists', async () => {
    visitVehicleResourceFindFirstMock.mockResolvedValueOnce({
      id: 'vehicle_1',
      site_id: 'site_1',
      label: '社用車A',
      max_stops: 1,
    });
    visitScheduleCountMock.mockResolvedValueOnce(1);

    const response = await PATCH(createPatchRequest({ vehicle_resource_id: 'vehicle_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '社用車A で訪問できる件数は最大 1 件です',
    });
    expect(visitScheduleCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        org_id: 'org_1',
        id: { not: 'schedule_1' },
        vehicle_resource_id: 'vehicle_1',
      }),
    });
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('rechecks selected vehicle stop limits inside the schedule PATCH transaction', async () => {
    visitVehicleResourceFindFirstMock.mockResolvedValue({
      id: 'vehicle_1',
      site_id: 'site_1',
      label: '社用車A',
      max_stops: 1,
    });
    visitScheduleCountMock.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    const response = await PATCH(createPatchRequest({ vehicle_resource_id: 'vehicle_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '社用車A で訪問できる件数は最大 1 件です',
    });
    expect(visitScheduleCountMock).toHaveBeenCalledTimes(2);
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('allows cancelling an over-capacity existing vehicle schedule without vehicle revalidation', async () => {
    visitVehicleResourceFindFirstMock.mockResolvedValue({
      id: 'vehicle_1',
      site_id: 'site_1',
      label: '社用車A',
      max_stops: 1,
    });
    visitScheduleCountMock.mockResolvedValue(99);
    visitScheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      cycle_id: 'cycle_1',
      visit_type: 'regular',
      priority: 'normal',
      schedule_status: 'planned',
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      time_window_start: new Date('1970-01-01T09:00:00.000Z'),
      time_window_end: new Date('1970-01-01T10:00:00.000Z'),
      route_order: 1,
      recurrence_rule: null,
      version: 1,
      confirmed_at: null,
      pharmacist_id: 'user_1',
      site_id: 'site_1',
      vehicle_resource_id: 'vehicle_1',
      visit_record: null,
      preparation: null,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await PATCH(createPatchRequest({ schedule_status: 'cancelled' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitVehicleResourceFindFirstMock).not.toHaveBeenCalled();
    expect(visitScheduleCountMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          schedule_status: 'cancelled',
          version: { increment: 1 },
        }),
      }),
    );
  });

  it('rejects schedule PATCH when the selected vehicle belongs to another site', async () => {
    visitVehicleResourceFindFirstMock.mockResolvedValueOnce({
      id: 'vehicle_2',
      site_id: 'site_2',
      label: '別拠点車両',
      max_stops: 8,
    });

    const response = await PATCH(createPatchRequest({ vehicle_resource_id: 'vehicle_2' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '選択した車両リソースは訪問予定の拠点では利用できません',
    });
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('revalidates an existing vehicle resource when moving schedule date', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce({
      patient: {
        scheduling_preference: null,
        residences: [{ facility: null }],
      },
    });
    visitScheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'planned',
      confirmed_at: null,
      pharmacist_id: 'user_1',
      site_id: 'site_1',
      vehicle_resource_id: 'vehicle_1',
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      time_window_start: null,
      time_window_end: null,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await PATCH(createPatchRequest({ scheduled_date: '2026-03-27' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitVehicleResourceFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'vehicle_1' }),
      }),
    );
    expect(visitScheduleCountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scheduled_date: new Date('2026-03-27'),
        }),
      }),
    );
  });

  it('rejects schedule date changes when the selected pharmacist has no shift', async () => {
    pharmacistShiftFindFirstMock.mockResolvedValueOnce(null);

    const response = await PATCH(createPatchRequest({ scheduled_date: '2026-03-27' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '選択した薬剤師のシフトがありません',
    });
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects schedule time changes outside the selected pharmacist shift', async () => {
    const response = await PATCH(
      createPatchRequest({
        time_window_start: '08:30',
        time_window_end: '09:30',
      }),
      {
        params: Promise.resolve({ id: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問開始時刻が薬剤師シフトの開始前です',
    });
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects schedule time changes that overlap an active schedule for the same pharmacist', async () => {
    visitScheduleTxFindFirstMock.mockResolvedValueOnce({ id: 'schedule_overlap' });

    const response = await PATCH(
      createPatchRequest({
        time_window_start: '09:30',
        time_window_end: '10:30',
      }),
      {
        params: Promise.resolve({ id: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同一薬剤師・同一日付の訪問時間帯が既存予定と重複しています。再読み込みしてください',
    });
    expect(visitScheduleTxFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        org_id: 'org_1',
        id: { not: 'schedule_1' },
        pharmacist_id: 'user_1',
        scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
        schedule_status: {
          in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
        },
        time_window_start: { lt: new Date('1970-01-01T10:30:00.000Z') },
        time_window_end: { gt: new Date('1970-01-01T09:30:00.000Z') },
      }),
      select: { id: true },
    });
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects schedule date changes outside patient preferred weekdays', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce({
      patient: {
        scheduling_preference: {
          preferred_weekdays: [4],
          preferred_time_from: null,
          preferred_time_to: null,
          facility_time_from: null,
          facility_time_to: null,
        },
        residences: [],
      },
    });

    const response = await PATCH(createPatchRequest({ scheduled_date: '2026-03-27' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '患者または施設の訪問希望曜日と一致しない日付です',
    });
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects schedule time changes outside patient and facility visit windows', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce({
      patient: {
        scheduling_preference: {
          preferred_weekdays: [],
          preferred_time_from: new Date('1970-01-01T09:00:00.000Z'),
          preferred_time_to: new Date('1970-01-01T12:00:00.000Z'),
          facility_time_from: null,
          facility_time_to: null,
        },
        residences: [
          {
            facility: {
              acceptance_time_from: new Date('1970-01-01T10:00:00.000Z'),
              acceptance_time_to: new Date('1970-01-01T11:00:00.000Z'),
              regular_visit_weekdays: [],
            },
          },
        ],
      },
    });

    const response = await PATCH(
      createPatchRequest({
        time_window_start: '09:30',
        time_window_end: '10:30',
      }),
      {
        params: Promise.resolve({ id: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問開始時刻が患者または施設の希望開始時刻 10:00 より前です',
    });
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('allows an org-wide pharmacist to reassign case or pharmacist', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      site_id: 'site_1',
      schedule_status: 'planned',
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      time_window_start: null,
      time_window_end: null,
      confirmed_at: null,
      pharmacist_id: 'user_1',
      vehicle_resource_id: null,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await PATCH(
      createPatchRequest({ case_id: 'case_other', pharmacist_id: 'user_other' }),
      {
        params: Promise.resolve({ id: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(validateOrgReferencesMock).toHaveBeenCalled();
  });

  it('rejects reversed time windows before loading or mutating the schedule', async () => {
    const response = await PATCH(
      createPatchRequest({
        time_window_start: '11:00',
        time_window_end: '10:00',
      }),
      {
        params: Promise.resolve({ id: 'schedule_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        time_window_end: ['終了時刻は開始時刻より後にしてください'],
      },
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects invalid calendar scheduled dates before loading or mutating the schedule', async () => {
    const response = await PATCH(createPatchRequest({ scheduled_date: '2026-02-30' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        scheduled_date: ['日付形式が不正です（YYYY-MM-DD）'],
      },
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects non-object patch payloads before loading the schedule', async () => {
    const response = await PATCH(createPatchRequest(['in_progress']), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects blank schedule ids before loading or updating the schedule', async () => {
    const response = await PATCH(createPatchRequest({ schedule_status: 'in_progress' }), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問予定IDが不正です',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects route_order changes for confirmed visits before conflict checks', async () => {
    visitScheduleFindFirstMock.mockResolvedValueOnce({
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
      confirmed_at: new Date('2026-03-25T12:00:00.000Z'),
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

    const response = await PATCH(createPatchRequest({ route_order: 2 }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '電話確定済みの訪問予定は順路を変更できません',
    });
    expect(visitScheduleProposalFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects route_order changes that conflict within the same pharmacist day', async () => {
    const response = await PATCH(createPatchRequest({ route_order: 2 }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '同一薬剤師・同一日付で route_order は重複できません',
    });
    expect(visitScheduleFindFirstMock).toHaveBeenLastCalledWith({
      where: {
        org_id: 'org_1',
        id: { not: 'schedule_1' },
        pharmacist_id: 'user_1',
        scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
        route_order: 2,
        schedule_status: { notIn: ['cancelled', 'rescheduled'] },
      },
      select: { id: true },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects route_order changes that conflict with an open proposal in the same pharmacist day', async () => {
    visitScheduleFindFirstMock
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce(null);
    visitScheduleProposalFindFirstMock.mockResolvedValueOnce({ id: 'proposal_1' });

    const response = await PATCH(createPatchRequest({ route_order: 2 }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '同一薬剤師・同一日付で route_order は重複できません',
    });
    expect(visitScheduleProposalFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        proposed_pharmacist_id: 'user_1',
        proposed_date: new Date('2026-03-26T00:00:00.000Z'),
        route_order: 2,
        finalized_schedule_id: null,
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
      },
      select: { id: true },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it.each(['cancelled', 'rescheduled'] as const)(
    'rejects route_order changes for %s schedules before conflict checks',
    async (scheduleStatus) => {
      visitScheduleFindFirstMock.mockResolvedValueOnce({
        id: 'schedule_1',
        case_id: 'case_1',
        cycle_id: 'cycle_1',
        visit_type: 'regular',
        schedule_status: scheduleStatus,
        scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
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

      const response = await PATCH(createPatchRequest({ route_order: 1 }), {
        params: Promise.resolve({ id: 'schedule_1' }),
      });

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '完了済みまたは中止済みの訪問予定は順路を変更できません',
      });
      expect(visitScheduleFindFirstMock).toHaveBeenCalledTimes(1);
      expect(visitScheduleProposalFindFirstMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
      expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
      expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
    },
  );

  it('rechecks route_order conflicts inside the update transaction', async () => {
    visitScheduleFindFirstMock
      .mockResolvedValueOnce({
        id: 'schedule_1',
        case_id: 'case_1',
        cycle_id: 'cycle_1',
        visit_type: 'regular',
        schedule_status: 'planned',
        scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
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
      })
      .mockResolvedValueOnce(null);
    visitScheduleTxFindFirstMock.mockResolvedValueOnce({ id: 'schedule_2' });

    const response = await PATCH(createPatchRequest({ route_order: 2 }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '同一薬剤師・同一日付で route_order は重複できません',
    });
    expect(visitScheduleTxFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { not: 'schedule_1' },
        pharmacist_id: 'user_1',
        scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
        route_order: 2,
        schedule_status: { notIn: ['cancelled', 'rescheduled'] },
      },
      select: { id: true },
    });
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rechecks open proposal route_order conflicts inside the update transaction', async () => {
    visitScheduleFindFirstMock
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce(null);
    visitScheduleProposalFindFirstMock.mockResolvedValueOnce(null);
    visitScheduleTxFindFirstMock.mockResolvedValueOnce(null);
    visitScheduleProposalTxFindFirstMock.mockResolvedValueOnce({ id: 'proposal_1' });

    const response = await PATCH(createPatchRequest({ route_order: 2 }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '同一薬剤師・同一日付で route_order は重複できません',
    });
    expect(visitScheduleProposalTxFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        proposed_pharmacist_id: 'user_1',
        proposed_date: new Date('2026-03-26T00:00:00.000Z'),
        route_order: 2,
        finalized_schedule_id: null,
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
      },
      select: { id: true },
    });
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns conflict when the schedule version changes before PATCH write', async () => {
    visitScheduleUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await PATCH(createPatchRequest({ schedule_status: 'in_progress' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '訪問予定が同時に更新されました。再読み込みしてください',
    });
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: EXPECTED_PATCH_GUARD,
      }),
    );
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns conflict when a locked-field PATCH loses a confirmation race', async () => {
    visitScheduleUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await PATCH(createPatchRequest({ scheduled_date: '2026-03-27' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '訪問予定が同時に更新されました。再読み込みしてください',
    });
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: EXPECTED_PATCH_GUARD,
      }),
    );
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('retries serializable route_order PATCH conflicts and succeeds', async () => {
    visitScheduleFindFirstMock
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce(null);
    visitScheduleTxFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      site_id: 'site_1',
      visit_type: 'regular',
      priority: 'normal',
      schedule_status: 'planned',
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      time_window_start: null,
      time_window_end: null,
      route_order: 2,
      recurrence_rule: null,
      version: 2,
      confirmed_at: null,
      pharmacist_id: 'user_1',
      vehicle_resource_id: null,
    });
    withOrgContextMock.mockImplementationOnce(async () => {
      throw buildSerializableConflictError();
    });

    const response = await PATCH(createPatchRequest({ route_order: 2 }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(withOrgContextMock).toHaveBeenCalledTimes(2);
    expect(withOrgContextMock).toHaveBeenNthCalledWith(
      1,
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
    expect(withOrgContextMock).toHaveBeenNthCalledWith(
      2,
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: EXPECTED_PATCH_GUARD,
        data: expect.objectContaining({
          route_order: 2,
          version: { increment: 1 },
        }),
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'visit_schedule_updated',
        changes: expect.objectContaining({
          routeOrderFrom: 1,
          routeOrderTo: 2,
        }),
      }),
    });
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'visit_schedules_update', schedule_id: 'schedule_1' },
    });
  });

  it('returns conflict when serializable route_order PATCH conflicts exceed retry limit', async () => {
    visitScheduleFindFirstMock
      .mockResolvedValueOnce({
        id: 'schedule_1',
        case_id: 'case_1',
        cycle_id: 'cycle_1',
        visit_type: 'regular',
        schedule_status: 'planned',
        scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
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
      })
      .mockResolvedValueOnce(null);
    withOrgContextMock.mockRejectedValue(buildSerializableConflictError());

    const response = await PATCH(createPatchRequest({ route_order: 2 }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'route_order の反映対象が同時に更新されました。再読み込みしてください',
    });
    expect(withOrgContextMock).toHaveBeenCalledTimes(3);
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects zero route_order values before loading the schedule', async () => {
    const response = await PATCH(createPatchRequest({ route_order: 0 }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON patch payloads before loading the schedule', async () => {
    const response = await PATCH(createMalformedJsonPatchRequest(), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when patch auth plumbing fails before loading the schedule', async () => {
    authMock.mockRejectedValueOnce(
      new Error('raw patch auth patient 山田 花子 token secret schedule memo'),
    );

    const response = await PATCH(createPatchRequest({ schedule_status: 'in_progress' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('raw patch auth');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).not.toContain('token secret');
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('allows an org-wide trainee to delete a schedule regardless of assignment', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist_trainee' });
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      pharmacist_id: 'user_other',
      version: 1,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await DELETE(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'schedule_1', org_id: 'org_1', version: 1 },
      data: { schedule_status: 'cancelled', version: { increment: 1 } },
    });
    expect(visitScheduleOverrideFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        source_schedule_id: 'schedule_1',
        status: 'pending',
      },
      select: { id: true },
    });
    expect(visitScheduleOverrideUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        source_schedule_id: 'schedule_1',
        status: 'pending',
        id: { in: ['override_1'] },
      },
      data: {
        status: 'cancelled',
      },
    });
    expect(visitScheduleProposalUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        reschedule_source_schedule_id: 'schedule_1',
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
        finalized_schedule_id: null,
      },
      data: {
        proposal_status: 'superseded',
      },
    });
  });

  it('rejects blank schedule ids before deleting the schedule', async () => {
    const response = await DELETE(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問予定IDが不正です',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('allows an admin to delete a schedule regardless of assignment', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      pharmacist_id: 'user_other',
      version: 1,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await DELETE(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'schedule_1', org_id: 'org_1', version: 1 },
      data: { schedule_status: 'cancelled', version: { increment: 1 } },
    });
  });

  it('returns conflict when delete loses a version race', async () => {
    visitScheduleUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await DELETE(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '訪問予定が同時に更新されました。再読み込みしてください',
    });
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'schedule_1', org_id: 'org_1', version: 1 },
      data: { schedule_status: 'cancelled', version: { increment: 1 } },
    });
    expect(visitScheduleOverrideFindManyMock).not.toHaveBeenCalled();
    expect(visitScheduleOverrideUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalUpdateManyMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when delete auth plumbing fails before loading the schedule', async () => {
    authMock.mockRejectedValueOnce(
      new Error('raw delete auth patient 山田 花子 token secret schedule memo'),
    );

    const response = await DELETE(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('raw delete auth');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).not.toContain('token secret');
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when pending override cancellation fails', async () => {
    visitScheduleOverrideUpdateManyMock.mockRejectedValueOnce(
      new Error('raw override cancel patient 山田 花子 token secret'),
    );

    const response = await DELETE(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('raw override');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).not.toContain('token secret');
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when delete audit logging fails', async () => {
    auditLogCreateMock.mockRejectedValueOnce(
      new Error('raw delete audit patient 山田 花子 token secret reason memo'),
    );

    const response = await DELETE(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('raw delete audit');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).not.toContain('token secret');
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('records the cancel reason in the audit log when the body provides one', async () => {
    const response = await DELETE(
      new NextRequest('http://localhost/api/visit-schedules/schedule_1', {
        method: 'DELETE',
        body: JSON.stringify({ reason_code: 'patient_request', reason_note: '家族から延期希望' }),
        headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
      }),
      { params: Promise.resolve({ id: 'schedule_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'visit_schedule_cancelled',
        target_type: 'VisitSchedule',
        target_id: 'schedule_1',
        changes: expect.objectContaining({
          reason_code: 'patient_request',
          reason_label: '患者都合',
          reason_note: '家族から延期希望',
          cancelled_override_ids: ['override_1'],
          cancelled_override_count: 1,
          superseded_reschedule_proposal_count: 1,
        }),
      }),
    });
  });

  it('still cancels without a body and logs an audit entry without a reason', async () => {
    const response = await DELETE(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'visit_schedule_cancelled',
        changes: expect.objectContaining({
          reason_code: null,
          reason_note: null,
          cancelled_override_ids: ['override_1'],
          cancelled_override_count: 1,
          superseded_reschedule_proposal_count: 1,
        }),
      }),
    });
  });

  it('rejects an unknown cancel reason code', async () => {
    const response = await DELETE(
      new NextRequest('http://localhost/api/visit-schedules/schedule_1', {
        method: 'DELETE',
        body: JSON.stringify({ reason_code: 'unknown_reason' }),
        headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
      }),
      { params: Promise.resolve({ id: 'schedule_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
  });
});
