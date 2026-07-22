import {
  createRequest,
  expectSensitiveNoStore,
  visitScheduleRouteMocks,
} from './route.test-support';
import { describe, expect, it, vi } from 'vitest';

const {
  careCaseFindFirstMock,
  membershipFindFirstMock,
  recordPhiReadAuditForRequestMock,
  visitScheduleFindFirstMock,
} = visitScheduleRouteMocks;

vi.mock('@/lib/audit/phi-read-audit', () => ({
  recordPhiReadAuditForRequest: visitScheduleRouteMocks.recordPhiReadAuditForRequestMock,
}));
vi.mock('@/lib/auth/config', () => ({
  auth: visitScheduleRouteMocks.authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: { findFirst: visitScheduleRouteMocks.membershipFindFirstMock },
    visitSchedule: {
      findFirst: visitScheduleRouteMocks.visitScheduleFindFirstMock,
      findMany: visitScheduleRouteMocks.visitScheduleFindManyMock,
      count: visitScheduleRouteMocks.visitScheduleCountMock,
    },
    visitScheduleProposal: {
      findFirst: visitScheduleRouteMocks.visitScheduleProposalFindFirstMock,
    },
    visitVehicleResource: { findFirst: visitScheduleRouteMocks.visitVehicleResourceFindFirstMock },
    visitPreparation: { findFirst: visitScheduleRouteMocks.visitPreparationFindFirstMock },
    pharmacistShift: { findFirst: visitScheduleRouteMocks.pharmacistShiftFindFirstMock },
    careCase: { findFirst: visitScheduleRouteMocks.careCaseFindFirstMock },
  },
}));

vi.mock('@/lib/db/rls', () => ({ withOrgContext: visitScheduleRouteMocks.withOrgContextMock }));
vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: visitScheduleRouteMocks.validateOrgReferencesMock,
}));
vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: visitScheduleRouteMocks.notifyWorkflowMutationMock,
}));
vi.mock('@/server/services/operational-tasks', () => ({
  resolveOperationalTasks: visitScheduleRouteMocks.resolveOperationalTasksMock,
}));
vi.mock('@/server/services/visit-preparation-readiness', () => ({
  evaluateVisitScheduleReadyTransition: visitScheduleRouteMocks.evaluateReadyTransitionMock,
  getVisitReadyTransitionErrorMessage: visitScheduleRouteMocks.getReadyTransitionErrorMessageMock,
  sanitizeVisitReadyTransitionDetails: visitScheduleRouteMocks.sanitizeReadyTransitionDetailsMock,
}));

import { GET } from './route';
describe('/api/visit-schedules/[id] GET', () => {
  it('returns the patient_id derived from the scheduled case', async () => {
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
      confirmed_at: null,
      pharmacist_id: 'user_1',
      site_id: 'site_1',
      vehicle_resource_id: null,
      visit_record: null,
      preparation: null,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
        patient: {
          id: 'patient_1',
          name: '患者A',
          archived_at: null,
          allergy_info: [{ substance: 'ペニシリン' }],
          insurances: [],
          lab_observations: [
            {
              analyte_code: 'k',
              value_numeric: 5.8,
              value_text: null,
              unit: 'mEq/L',
              measured_at: new Date('2026-03-20T00:00:00.000Z'),
              abnormal_flag: 'H',
            },
          ],
          residences: [{ address: '東京都', building_id: null, unit_name: null }],
        },
      },
    });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        id: 'schedule_1',
        case_id: 'case_1',
        case_version: 7,
        cycle_id: 'cycle_1',
        patient_id: 'patient_1',
        patient_summary: expect.objectContaining({
          patient_id: 'patient_1',
          name: '患者A',
          insurance: expect.objectContaining({
            missing: true,
          }),
          safety: expect.objectContaining({
            has_allergy: true,
            critical_lab_count: 1,
          }),
        }),
      },
    });
    expect(body).not.toHaveProperty('id');
    expect(body.data.case_.patient).not.toHaveProperty('allergy_info');
    expect(body.data.case_.patient).not.toHaveProperty('insurances');
    expect(body.data.case_.patient).not.toHaveProperty('lab_observations');
    expect(body.data.case_.patient).not.toHaveProperty('archived_at');
    const patientSelect =
      visitScheduleFindFirstMock.mock.calls[0]?.[0]?.include.case_.select.patient.select;
    expect(patientSelect.insurances.where).toMatchObject({ org_id: 'org_1' });
    expect(patientSelect.lab_observations.where).toMatchObject({ org_id: 'org_1' });
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledTimes(1);
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }),
      {
        patientId: 'patient_1',
        targetType: 'visit_schedule',
        targetId: 'schedule_1',
        view: 'visit_schedule_detail',
      },
    );
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
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('does not audit when the schedule is not found', async () => {
    visitScheduleFindFirstMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'missing_schedule' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('does not audit when the scheduled case cannot be resolved', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('allows a clerk to read an org-scoped schedule and records one patient audit', async () => {
    membershipFindFirstMock.mockResolvedValueOnce({ role: 'clerk' });
    visitScheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      cycle_id: 'cycle_1',
      visit_type: 'regular',
      scheduled_date: new Date('2026-03-26T00:00:00.000Z'),
      confirmed_at: null,
      pharmacist_id: 'user_other',
      visit_record: null,
      preparation: null,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
        patient: { id: 'patient_1', name: '患者A' },
      },
    });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'clerk' }),
      expect.objectContaining({ patientId: 'patient_1', view: 'visit_schedule_detail' }),
    );
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
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });
});
