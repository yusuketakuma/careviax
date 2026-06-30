import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const {
  requireAuthContextMock,
  withOrgContextMock,
  proposalFindFirstMock,
  proposalFindManyMock,
  proposalUpdateMock,
  proposalUpdateManyMock,
  scheduleFindFirstMock,
  scheduleFindManyMock,
  scheduleCountMock,
  scheduleUpdateManyMock,
  scheduleCreateMock,
  pharmacistShiftFindFirstMock,
  pharmacyOperatingHoursFindManyMock,
  businessHolidayFindManyMock,
  vehicleResourceFindFirstMock,
  patientInsuranceFindFirstMock,
  userFindFirstMock,
  consentRecordFindFirstMock,
  managementPlanFindFirstMock,
  contactLogCreateMock,
  contactLogFindFirstMock,
  contactLogUpdateManyMock,
  auditLogCreateMock,
  auditLogFindFirstMock,
  overrideFindFirstMock,
  overrideUpdateMock,
  overrideUpdateManyMock,
  evaluateVisitWorkflowGateMock,
  userFindManyMock,
  computeOptimizedVisitRouteMock,
  upsertOperationalTaskMock,
  resolveOperationalTasksMock,
  notifyWorkflowMutationMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  proposalFindFirstMock: vi.fn(),
  proposalFindManyMock: vi.fn(),
  proposalUpdateMock: vi.fn(),
  proposalUpdateManyMock: vi.fn(),
  scheduleFindFirstMock: vi.fn(),
  scheduleFindManyMock: vi.fn(),
  scheduleCountMock: vi.fn(),
  scheduleUpdateManyMock: vi.fn(),
  scheduleCreateMock: vi.fn(),
  pharmacistShiftFindFirstMock: vi.fn(),
  pharmacyOperatingHoursFindManyMock: vi.fn(),
  businessHolidayFindManyMock: vi.fn(),
  vehicleResourceFindFirstMock: vi.fn(),
  patientInsuranceFindFirstMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  consentRecordFindFirstMock: vi.fn(),
  managementPlanFindFirstMock: vi.fn(),
  contactLogCreateMock: vi.fn(),
  contactLogFindFirstMock: vi.fn(),
  contactLogUpdateManyMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  auditLogFindFirstMock: vi.fn(),
  overrideFindFirstMock: vi.fn(),
  overrideUpdateMock: vi.fn(),
  overrideUpdateManyMock: vi.fn(),
  evaluateVisitWorkflowGateMock: vi.fn(),
  userFindManyMock: vi.fn(),
  computeOptimizedVisitRouteMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
  resolveOperationalTasksMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitScheduleProposal: {
      findFirst: proposalFindFirstMock,
      findMany: proposalFindManyMock,
    },
    visitSchedule: {
      findMany: scheduleFindManyMock,
      count: scheduleCountMock,
    },
    visitScheduleContactLog: {
      findFirst: contactLogFindFirstMock,
    },
    visitScheduleOverride: {
      findFirst: overrideFindFirstMock,
    },
    auditLog: {
      findFirst: auditLogFindFirstMock,
    },
    user: {
      findMany: userFindManyMock,
      findFirst: userFindFirstMock,
    },
    patientInsurance: {
      findFirst: patientInsuranceFindFirstMock,
    },
    consentRecord: {
      findFirst: consentRecordFindFirstMock,
    },
    managementPlan: {
      findFirst: managementPlanFindFirstMock,
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

vi.mock('@/server/services/visit-route-engine', () => ({
  computeOptimizedVisitRoute: computeOptimizedVisitRouteMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { GET, PATCH } from './route';

function createRequest(body?: unknown, headers?: Record<string, string>) {
  if (body === undefined) {
    return new NextRequest('http://localhost/api/visit-schedule-proposals/proposal_1', {
      headers,
    });
  }
  return new NextRequest('http://localhost/api/visit-schedule-proposals/proposal_1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

function createMalformedJsonPatchRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/visit-schedule-proposals/proposal_1', {
    method: 'PATCH',
    body: '{"action":',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
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
    vehicle_resource_id: null,
    vehicle_resource: null,
    created_at: new Date('2026-03-26T09:00:00.000Z'),
    medication_end_date: new Date('2026-03-31T00:00:00.000Z'),
    visit_deadline_date: new Date('2026-03-30T00:00:00.000Z'),
    escalation_reason: null,
    suggested_recurrence_rule: null,
    finalized_schedule_id: null,
    reschedule_source_schedule_id: null,
    case_: {
      patient_id: 'patient_1',
      required_visit_support: null,
      patient: {
        id: 'patient_1',
        name: '患者A',
        phone: '03-0000-0000',
        medical_insurance_number: 'MED-SECRET-1',
        care_insurance_number: 'CARE-SECRET-1',
        allergy_info: { freeText: 'アレルギー詳細' },
        notes: '患者メモ詳細',
        residences: [
          {
            address: '東京都千代田区1-1-1',
            building_id: '建物A',
            unit_name: '203号室',
            lat: 35.2,
            lng: 139.2,
            geocode_source: 'internal-geocoder',
          },
        ],
      },
    },
    ...overrides,
  };
}

function buildTxMock() {
  return {
    visitSchedule: {
      findFirst: scheduleFindFirstMock,
      findMany: scheduleFindManyMock,
      count: scheduleCountMock,
      updateMany: scheduleUpdateManyMock,
      create: scheduleCreateMock,
    },
    pharmacistShift: {
      findFirst: pharmacistShiftFindFirstMock,
    },
    pharmacyOperatingHours: {
      findMany: pharmacyOperatingHoursFindManyMock,
    },
    businessHoliday: {
      findMany: businessHolidayFindManyMock,
    },
    visitVehicleResource: {
      findFirst: vehicleResourceFindFirstMock,
    },
    patientInsurance: {
      findFirst: patientInsuranceFindFirstMock,
    },
    user: {
      findFirst: userFindFirstMock,
    },
    consentRecord: {
      findFirst: consentRecordFindFirstMock,
    },
    managementPlan: {
      findFirst: managementPlanFindFirstMock,
    },
    visitScheduleProposal: {
      findFirst: proposalFindFirstMock,
      findMany: proposalFindManyMock,
      update: proposalUpdateMock,
      updateMany: proposalUpdateManyMock,
    },
    visitScheduleContactLog: {
      findFirst: contactLogFindFirstMock,
      create: contactLogCreateMock,
      updateMany: contactLogUpdateManyMock,
    },
    visitScheduleOverride: {
      findFirst: overrideFindFirstMock,
      update: overrideUpdateMock,
      updateMany: overrideUpdateManyMock,
    },
    auditLog: {
      findFirst: auditLogFindFirstMock,
      create: auditLogCreateMock,
    },
  };
}

function buildSerializableConflictError() {
  return new Prisma.PrismaClientKnownRequestError('Serializable transaction conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

function buildUniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('/api/visit-schedule-proposals/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    proposalFindFirstMock.mockResolvedValue(buildProposal());
    proposalFindManyMock.mockResolvedValue([]);
    proposalUpdateMock.mockResolvedValue({ id: 'proposal_1' });
    proposalUpdateManyMock.mockResolvedValue({ count: 1 });
    scheduleFindFirstMock.mockResolvedValue(null);
    scheduleFindManyMock.mockResolvedValue([]);
    scheduleCountMock.mockResolvedValue(0);
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
    pharmacistShiftFindFirstMock.mockResolvedValue({
      site_id: 'site_1',
      available: true,
      available_from: new Date('1970-01-01T08:30:00.000Z'),
      available_to: new Date('1970-01-01T17:30:00.000Z'),
    });
    pharmacyOperatingHoursFindManyMock.mockResolvedValue([]);
    businessHolidayFindManyMock.mockResolvedValue([]);
    vehicleResourceFindFirstMock.mockResolvedValue({
      site_id: 'site_1',
      label: '社用車A',
      max_stops: 8,
    });
    patientInsuranceFindFirstMock.mockResolvedValue(null);
    userFindFirstMock.mockResolvedValue({ max_weekly_visits: null });
    consentRecordFindFirstMock.mockResolvedValue({ id: 'consent_1' });
    managementPlanFindFirstMock.mockResolvedValue({
      id: 'plan_1',
      status: 'approved',
      next_review_date: null,
    });
    contactLogCreateMock.mockResolvedValue({ id: 'contact_log_1' });
    contactLogFindFirstMock.mockResolvedValue(null);
    contactLogUpdateManyMock.mockResolvedValue({ count: 1 });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    auditLogFindFirstMock.mockResolvedValue(null);
    overrideFindFirstMock.mockResolvedValue({
      id: 'override_1',
      status: 'pending',
      approved_at: new Date('2026-03-26T10:00:00.000Z'),
      source_schedule: {
        schedule_status: 'rescheduled',
      },
    });
    overrideUpdateMock.mockResolvedValue({ id: 'override_1' });
    overrideUpdateManyMock.mockResolvedValue({ count: 1 });
    evaluateVisitWorkflowGateMock.mockResolvedValue({
      ok: true,
      issues: [],
      consentId: 'consent_1',
      managementPlanId: 'plan_1',
    });
    userFindManyMock.mockResolvedValue([
      { id: 'pharmacist_1', name: '薬剤師A', name_kana: 'ヤクザイシA' },
      { id: 'pharmacist_2', name: '薬剤師B', name_kana: 'ヤクザイシB' },
    ]);
    computeOptimizedVisitRouteMock.mockResolvedValue({
      status: 'ok',
      note: null,
      travelMode: 'DRIVE',
      origin: { lat: 35.1, lng: 139.1, label: '拠点A' },
      encodedPath: 'encoded',
      orderedScheduleIds: ['schedule_1', 'proposal:proposal_1'],
      totalDistanceMeters: 1200,
      totalDurationSeconds: 900,
      stopSummaries: [
        {
          scheduleId: 'schedule_1',
          optimizedOrder: 1,
          arrivalOffsetSeconds: 300,
          distanceFromPreviousMeters: 500,
          durationFromPreviousSeconds: 300,
        },
        {
          scheduleId: 'proposal:proposal_1',
          optimizedOrder: 2,
          arrivalOffsetSeconds: 900,
          distanceFromPreviousMeters: 700,
          durationFromPreviousSeconds: 600,
        },
      ],
    });

    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(buildTxMock()));
  });

  it('returns proposal detail with related candidates and route preview', async () => {
    proposalFindFirstMock.mockResolvedValueOnce({
      ...buildProposal({
        created_at: new Date('2026-03-26T09:00:00.000Z'),
        reject_reason: '東京都港区2-2-2 090-1234-5678 アムロジピン 処方詳細',
        case_: {
          patient: {
            id: 'patient_1',
            name: '患者A',
            phone: '03-0000-0000',
            medical_insurance_number: 'MED-SECRET-1',
            care_insurance_number: 'CARE-SECRET-1',
            allergy_info: { freeText: 'アレルギー詳細' },
            notes: '患者メモ詳細',
            residences: [
              {
                address: '東京都千代田区1-1-1',
                building_id: '建物A',
                unit_name: '203号室',
                lat: 35.2,
                lng: 139.2,
                geocode_source: 'internal-geocoder',
              },
            ],
          },
        },
        site: {
          id: 'site_1',
          name: '拠点A',
          address: '東京都千代田区2-2-2',
          lat: 35.1,
          lng: 139.1,
        },
        vehicle_resource_id: 'vehicle_1',
        vehicle_resource: {
          id: 'vehicle_1',
          label: '社用車A',
          travel_mode: 'DRIVE',
          max_stops: 6,
          max_route_duration_minutes: 180,
        },
        contact_logs: [
          {
            id: 'log_1',
            outcome: 'attempted',
            contact_method: 'phone',
            contact_name: '本人',
            contact_phone: '090-0000-0000',
            note: '折返し待ち',
            callback_due_at: null,
            called_at: new Date('2026-03-26T10:00:00.000Z'),
            called_by: 'user_1',
            idempotency_key: 'contact-key-1',
            request_fingerprint: 'contact-fingerprint-1',
          },
        ],
        finalized_schedule: null,
        reschedule_source_schedule: null,
      }),
    });
    proposalFindManyMock.mockResolvedValueOnce([
      {
        ...buildProposal({
          id: 'proposal_2',
          proposed_pharmacist_id: 'pharmacist_2',
          priority: 'emergency',
          reject_reason: '埼玉県川口市9-9-9 090-9999-9999 ワルファリン 処方詳細',
          route_distance_score: 3.5,
          proposed_date: new Date('2026-03-28T00:00:00.000Z'),
          case_: {
            patient: {
              id: 'patient_1',
              name: '患者A',
              phone: '03-9999-9999',
              medical_insurance_number: 'MED-SECRET-RELATED',
              notes: '関連候補患者メモ',
              residences: [
                {
                  address: '東京都千代田区1-1-1',
                  building_id: '建物A',
                  unit_name: '203号室',
                  lat: 35.2,
                  lng: 139.2,
                  geocode_source: 'related-geocoder',
                },
              ],
            },
          },
          site: {
            id: 'site_1',
            name: '拠点A',
            address: '東京都千代田区2-2-2',
            lat: 35.1,
            lng: 139.1,
          },
          vehicle_resource_id: 'vehicle_1',
          vehicle_resource: {
            id: 'vehicle_1',
            label: '社用車A',
            travel_mode: 'DRIVE',
            max_stops: 6,
            max_route_duration_minutes: 180,
          },
        }),
      },
    ]);
    scheduleFindManyMock.mockResolvedValueOnce([
      {
        id: 'schedule_1',
        visit_type: 'regular',
        priority: 'urgent',
        schedule_status: 'planned',
        route_order: 1,
        scheduled_date: new Date('2026-03-27T00:00:00.000Z'),
        time_window_start: new Date('1970-01-01T08:30:00.000Z'),
        time_window_end: new Date('1970-01-01T09:00:00.000Z'),
        case_: {
          patient: {
            name: '患者B',
            residences: [
              {
                address: '東京都港区3-3-3',
                lat: 35.3,
                lng: 139.3,
              },
            ],
          },
        },
        site: {
          id: 'site_1',
          name: '拠点A',
          address: '東京都千代田区2-2-2',
          lat: 35.1,
          lng: 139.1,
        },
        vehicle_resource: {
          id: 'vehicle_2',
          label: '社用車B',
          travel_mode: 'DRIVE',
          max_stops: 4,
          max_route_duration_minutes: 120,
        },
      },
    ]);

    const response = await GET(createRequest(undefined, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(computeOptimizedVisitRouteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        waypoints: expect.arrayContaining([
          expect.objectContaining({ scheduleId: 'schedule_1', priority: 'urgent' }),
          expect.objectContaining({ scheduleId: 'proposal:proposal_1', priority: 'normal' }),
          expect.objectContaining({ scheduleId: 'proposal:proposal_2', priority: 'emergency' }),
        ]),
      }),
    );
    const body = await response.json();
    expect(body).toMatchObject({
      data: expect.objectContaining({
        id: 'proposal_1',
        vehicle_resource: expect.objectContaining({ id: 'vehicle_1', label: '社用車A' }),
        contact_logs: [
          {
            id: 'log_1',
            outcome: 'attempted',
            contact_method: 'phone',
            callback_due_at: null,
            called_at: '2026-03-26T10:00:00.000Z',
            has_note: true,
          },
        ],
        related_proposals: [
          expect.objectContaining({
            id: 'proposal_2',
            vehicle_resource: expect.objectContaining({ id: 'vehicle_1', label: '社用車A' }),
          }),
        ],
        pharmacist_day_schedules: [
          expect.objectContaining({
            id: 'schedule_1',
            vehicle_resource: expect.objectContaining({ id: 'vehicle_2', label: '社用車B' }),
          }),
        ],
        creation_diagnostics: null,
        route_preview: expect.objectContaining({
          plan: expect.objectContaining({
            orderedScheduleIds: expect.arrayContaining(['schedule_1', 'proposal:proposal_1']),
          }),
          points: expect.arrayContaining([
            expect.objectContaining({ point_kind: 'proposal', schedule_id: 'proposal:proposal_1' }),
            expect.objectContaining({ point_kind: 'proposal', schedule_id: 'proposal:proposal_2' }),
          ]),
        }),
      }),
    });
    expect(body.data).not.toHaveProperty('reject_reason');
    expect(body.data.related_proposals[0]).not.toHaveProperty('reject_reason');
    expect(body.data.case_).not.toHaveProperty('patient_id');
    expect(body.data.case_.patient).toEqual({
      id: 'patient_1',
      name: '患者A',
      residences: [
        {
          address: '東京都千代田区1-1-1',
          building_id: '建物A',
          unit_name: '203号室',
          lat: 35.2,
          lng: 139.2,
        },
      ],
    });
    expect(body.data.related_proposals[0].case_).not.toHaveProperty('patient_id');
    expect(body.data.related_proposals[0].case_.patient).not.toHaveProperty('phone');
    expect(body.data.related_proposals[0].case_.patient).not.toHaveProperty(
      'medical_insurance_number',
    );
    expect(body.data.contact_logs[0]).not.toHaveProperty('contact_name');
    expect(body.data.contact_logs[0]).not.toHaveProperty('contact_phone');
    expect(body.data.contact_logs[0]).not.toHaveProperty('note');
    expect(body.data.contact_logs[0]).not.toHaveProperty('called_by');
    expect(body.data.contact_logs[0]).not.toHaveProperty('idempotency_key');
    expect(body.data.contact_logs[0]).not.toHaveProperty('request_fingerprint');
    expect(JSON.stringify(body)).not.toContain('本人');
    expect(JSON.stringify(body)).not.toContain('090-0000-0000');
    expect(JSON.stringify(body)).not.toContain('折返し待ち');
    expect(JSON.stringify(body)).not.toContain('contact-key-1');
    expect(JSON.stringify(body)).not.toContain('contact-fingerprint-1');
    expect(JSON.stringify(body)).not.toContain('03-0000-0000');
    expect(JSON.stringify(body)).not.toContain('03-9999-9999');
    expect(JSON.stringify(body)).not.toContain('MED-SECRET-1');
    expect(JSON.stringify(body)).not.toContain('CARE-SECRET-1');
    expect(JSON.stringify(body)).not.toContain('MED-SECRET-RELATED');
    expect(JSON.stringify(body)).not.toContain('アレルギー詳細');
    expect(JSON.stringify(body)).not.toContain('患者メモ詳細');
    expect(JSON.stringify(body)).not.toContain('関連候補患者メモ');
    expect(JSON.stringify(body)).not.toContain('internal-geocoder');
    expect(JSON.stringify(body)).not.toContain('related-geocoder');
    expect(JSON.stringify(body)).not.toContain('東京都港区2-2-2');
    expect(JSON.stringify(body)).not.toContain('090-1234-5678');
    expect(JSON.stringify(body)).not.toContain('アムロジピン');
    expect(JSON.stringify(body)).not.toContain('埼玉県川口市9-9-9');
    expect(JSON.stringify(body)).not.toContain('090-9999-9999');
    expect(JSON.stringify(body)).not.toContain('ワルファリン');
  });

  it('grants org-wide roles unscoped org-only access to proposal detail, related proposals, and day schedules', async () => {
    const response = await GET(createRequest(undefined, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    // 組織横断アクセスロール(pharmacist)は担当割当スコープが撤廃され、
    // どのクエリにも AND/OR 担当割当句が付与されない(組織内フルアクセス)。
    expect(proposalFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'proposal_1',
          org_id: 'org_1',
        }),
      }),
    );
    expect(proposalFindFirstMock.mock.calls[0]?.[0]?.where).not.toHaveProperty('AND');
    expect(proposalFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
        }),
      }),
    );
    expect(proposalFindManyMock.mock.calls[0]?.[0]?.where).not.toHaveProperty('AND');
    expect(scheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
        }),
      }),
    );
    expect(scheduleFindManyMock.mock.calls[0]?.[0]?.where).not.toHaveProperty('AND');
  });

  it('rejects blank proposal ids before detail lookups or route preview side effects', async () => {
    const response = await GET(createRequest(undefined, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問候補IDが不正です',
    });
    expect(proposalFindFirstMock).not.toHaveBeenCalled();
    expect(proposalFindManyMock).not.toHaveBeenCalled();
    expect(scheduleFindManyMock).not.toHaveBeenCalled();
    expect(auditLogFindFirstMock).not.toHaveBeenCalled();
    expect(userFindManyMock).not.toHaveBeenCalled();
    expect(computeOptimizedVisitRouteMock).not.toHaveBeenCalled();
  });

  it('denies unassigned proposal detail before route planning or enrichment reads', async () => {
    proposalFindFirstMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest(undefined, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(proposalFindManyMock).not.toHaveBeenCalled();
    expect(scheduleFindManyMock).not.toHaveBeenCalled();
    expect(auditLogFindFirstMock).not.toHaveBeenCalled();
    expect(userFindManyMock).not.toHaveBeenCalled();
    expect(computeOptimizedVisitRouteMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when proposal detail lookup fails unexpectedly', async () => {
    proposalFindFirstMock.mockRejectedValueOnce(
      new Error('患者A 東京都千代田区1-1-1 090-0000-0000 アムロジピン workflow detail'),
    );

    const response = await GET(createRequest(undefined, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
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
    expect(JSON.stringify(body)).not.toContain('患者A');
    expect(JSON.stringify(body)).not.toContain('東京都千代田区1-1-1');
    expect(JSON.stringify(body)).not.toContain('090-0000-0000');
    expect(JSON.stringify(body)).not.toContain('アムロジピン');
    expect(JSON.stringify(body)).not.toContain('workflow detail');
    expect(proposalFindManyMock).not.toHaveBeenCalled();
    expect(scheduleFindManyMock).not.toHaveBeenCalled();
    expect(auditLogFindFirstMock).not.toHaveBeenCalled();
    expect(userFindManyMock).not.toHaveBeenCalled();
    expect(computeOptimizedVisitRouteMock).not.toHaveBeenCalled();
  });

  it('returns persisted creation diagnostics when available', async () => {
    auditLogFindFirstMock.mockResolvedValueOnce({
      changes: {
        diagnostics: {
          accepted: [
            {
              pharmacist_id: 'pharmacist_1',
              pharmacist_name: '薬剤師A',
              site_id: 'site_1',
              site_name: '拠点A',
              proposed_date: '2026-03-27',
              travel_mode: 'DRIVE',
              route_order: 1,
              route_distance_score: 4.2,
              travel_summary: '実道路移動 約12分',
              assignment_mode: 'primary',
              care_relationship: 'primary',
              score: 8.5,
              score_breakdown: {
                geocodePenalty: 0,
                facilityBonus: 0,
                workloadPenalty: 2,
                slackPenalty: 0,
                lockPenalty: 0,
                cadencePenalty: 0,
              },
              time_window_start: '1970-01-01T09:00:00.000Z',
              time_window_end: '1970-01-01T10:00:00.000Z',
            },
          ],
          rejected: [],
        },
      },
    });

    const response = await GET(createRequest(undefined, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    await expect(response.json()).resolves.toMatchObject({
      data: expect.objectContaining({
        creation_diagnostics: expect.objectContaining({
          accepted: [expect.objectContaining({ pharmacist_name: '薬剤師A' })],
        }),
      }),
    });
  });

  it('rejects confirmation before approval and patient contact', async () => {
    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'この候補は承認後の電話確認を経てから確定してください',
    });
    expect(scheduleCreateMock).not.toHaveBeenCalled();
  });

  it('returns the finalized schedule when a confirmed proposal is retried', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'confirmed',
        patient_contact_status: 'confirmed',
        finalized_schedule_id: 'schedule_1',
        reject_reason: '東京都港区2-2-2 090-1234-5678 アムロジピン 処方詳細',
      }),
    );
    scheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      org_id: 'org_1',
      case_id: 'case_1',
    });

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        alreadyFinalized: true,
        proposal: {
          proposal_status: 'confirmed',
          finalized_schedule_id: 'schedule_1',
        },
        schedule: {
          id: 'schedule_1',
        },
      },
    });
    expect(body.data.proposal.reject_reason).toBeUndefined();
    expect(scheduleFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'schedule_1',
        org_id: 'org_1',
        case_id: 'case_1',
      }),
    });
    expect(scheduleCreateMock).not.toHaveBeenCalled();
    expect(proposalUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns a conflict when a finalized proposal points to an unavailable schedule', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'confirmed',
        patient_contact_status: 'confirmed',
        finalized_schedule_id: 'schedule_missing',
      }),
    );
    scheduleFindFirstMock.mockResolvedValueOnce(null);

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '確定済み訪問を取得できません。再読み込みしてください',
    });
    expect(scheduleCreateMock).not.toHaveBeenCalled();
    expect(proposalUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects non-object patch payloads before loading the proposal', async () => {
    const response = await PATCH(createRequest([], { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(proposalFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(proposalUpdateMock).not.toHaveBeenCalled();
    expect(contactLogCreateMock).not.toHaveBeenCalled();
    expect(scheduleCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON patch payloads before loading the proposal', async () => {
    const response = await PATCH(createMalformedJsonPatchRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(proposalFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(proposalUpdateMock).not.toHaveBeenCalled();
    expect(contactLogCreateMock).not.toHaveBeenCalled();
    expect(scheduleCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when patch auth plumbing fails before loading the proposal', async () => {
    requireAuthContextMock.mockRejectedValueOnce(
      new Error('raw patch auth patient 山田 花子 token secret proposal memo'),
    );

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
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
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('raw patch auth');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).not.toContain('token secret');
    expect(proposalFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(proposalUpdateMock).not.toHaveBeenCalled();
    expect(contactLogCreateMock).not.toHaveBeenCalled();
    expect(scheduleCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['null', null],
  ])('rejects %s reject reasons before loading the proposal', async (_caseName, rejectReason) => {
    const response = await PATCH(
      createRequest({ action: 'reject', reject_reason: rejectReason }, { 'x-org-id': 'org_1' }),
      {
        params: Promise.resolve({ id: 'proposal_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
    });
    expect(proposalFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(proposalUpdateMock).not.toHaveBeenCalled();
    expect(contactLogCreateMock).not.toHaveBeenCalled();
    expect(scheduleCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('keeps legacy single reject requests compatible when no reject reason is provided', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'proposed',
        patient_contact_status: 'pending',
      }),
    );

    const response = await PATCH(createRequest({ action: 'reject' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(proposalUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'proposal_1',
        org_id: 'org_1',
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
        finalized_schedule_id: null,
      },
      data: {
        proposal_status: 'rejected',
        reject_reason: null,
      },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: {
          proposal_status_from: 'proposed',
          proposal_status_to: 'rejected',
          patient_contact_status_from: 'pending',
          patient_contact_status_to: 'pending',
          reject_reason_recorded: false,
          reject_reason_storage: null,
          reject_reason_text_stored: false,
        },
      }),
    });
  });

  it('rejects blank proposal ids before parsing or mutating the proposal', async () => {
    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問候補IDが不正です',
    });
    expect(proposalFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(proposalUpdateMock).not.toHaveBeenCalled();
    expect(proposalUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleFindFirstMock).not.toHaveBeenCalled();
    expect(scheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleCreateMock).not.toHaveBeenCalled();
    expect(contactLogCreateMock).not.toHaveBeenCalled();
    expect(contactLogUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(overrideUpdateMock).not.toHaveBeenCalled();
    expect(evaluateVisitWorkflowGateMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed contact phone before loading the proposal', async () => {
    const response = await PATCH(
      createRequest(
        {
          action: 'contact_attempt',
          outcome: 'attempted',
          idempotency_key: 'contact-phone-invalid',
          contact_method: 'phone',
          contact_phone: '090-ABCD-1234',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'proposal_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        contact_phone: ['電話番号形式が不正です'],
      },
    });
    expect(proposalFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(proposalUpdateMock).not.toHaveBeenCalled();
    expect(contactLogCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('denies unassigned contact attempts before update, contact, audit, task, or notify side effects', async () => {
    proposalFindFirstMock.mockResolvedValueOnce(null);

    const response = await PATCH(
      createRequest(
        {
          action: 'contact_attempt',
          outcome: 'attempted',
          idempotency_key: 'contact-unassigned',
          contact_method: 'phone',
          callback_due_at: '2026-03-30T09:00:00.000Z',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'proposal_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    // 組織横断アクセスロール(pharmacist)は担当割当スコープが撤廃され、
    // 提案ルックアップは org_id ベースの組織内検索のみ(AND 担当割当句なし)。
    // ここでは提案自体が存在しないため 404 となる(クロス組織/担当外による拒否ではない)。
    expect(proposalFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'proposal_1',
          org_id: 'org_1',
        }),
      }),
    );
    expect(proposalFindFirstMock.mock.calls[0]?.[0]?.where).not.toHaveProperty('AND');
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(proposalUpdateMock).not.toHaveBeenCalled();
    expect(contactLogCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('requires a confirmed phone result before finalizing the proposal', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'attempted',
      }),
    );

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

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
      }),
    );

    const response = await PATCH(
      createRequest(
        {
          action: 'contact_attempt',
          outcome: 'confirmed',
          idempotency_key: 'contact-confirmed-1',
          contact_method: 'phone',
          contact_name: '本人',
          contact_phone: ' 090-0000-1111 ',
          note: '了承済み',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'proposal_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(contactLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        proposal_id: 'proposal_1',
        patient_id: 'patient_1',
        outcome: 'confirmed',
        contact_method: 'phone',
        contact_name: '本人',
        contact_phone: '090-0000-1111',
        note: '了承済み',
        idempotency_key: 'contact-confirmed-1',
        request_fingerprint: expect.any(String),
      }),
    });
    expect(proposalUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'proposal_1',
        org_id: 'org_1',
        proposal_status: 'patient_contact_pending',
        finalized_schedule_id: null,
      },
      data: expect.objectContaining({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
      }),
    });
    expect(resolveOperationalTasksMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        dedupeKey: 'visit-contact-followup:proposal_1',
        status: 'completed',
      }),
    );
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('replays a concurrent contact attempt winner when the idempotency key insert races', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'pending',
      }),
    );
    contactLogFindFirstMock.mockResolvedValueOnce(null).mockImplementationOnce(async () => ({
      proposal_id: 'proposal_1',
      request_fingerprint:
        contactLogCreateMock.mock.calls[0]?.[0]?.data?.request_fingerprint ?? null,
      called_by: 'user_1',
    }));
    contactLogCreateMock.mockRejectedValueOnce(buildUniqueConstraintError());

    const response = await PATCH(
      createRequest(
        {
          action: 'contact_attempt',
          outcome: 'confirmed',
          idempotency_key: 'contact-confirmed-race',
          contact_method: 'phone',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'proposal_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(contactLogCreateMock).toHaveBeenCalledOnce();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects stale non-confirmed contact results after a proposal is already confirmed by phone', async () => {
    proposalFindFirstMock
      .mockResolvedValueOnce(
        buildProposal({
          proposal_status: 'patient_contact_pending',
          patient_contact_status: 'confirmed',
        }),
      )
      .mockResolvedValueOnce({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        finalized_schedule_id: null,
      });

    const response = await PATCH(
      createRequest(
        {
          action: 'contact_attempt',
          outcome: 'attempted',
          idempotency_key: 'contact-stale-attempted-after-confirmed',
          contact_method: 'phone',
          callback_due_at: '2026-06-30T09:00:00.000Z',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'proposal_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '患者確認済みの連絡結果は未接続へ戻せません。再読み込みしてください',
    });
    expect(proposalUpdateManyMock).not.toHaveBeenCalled();
    expect(contactLogCreateMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('keeps change_requested outcomes open as reschedule pending proposals', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'pending',
      }),
    );

    const response = await PATCH(
      createRequest(
        {
          action: 'contact_attempt',
          outcome: 'change_requested',
          idempotency_key: 'contact-change-requested-1',
          contact_method: 'email',
          note: '午前帯のみ希望',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'proposal_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(proposalUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'proposal_1',
        org_id: 'org_1',
        proposal_status: 'patient_contact_pending',
        finalized_schedule_id: null,
      },
      data: expect.objectContaining({
        proposal_status: 'reschedule_pending',
        patient_contact_status: 'change_requested',
      }),
    });
    expect(resolveOperationalTasksMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        dedupeKey: 'visit-contact-followup:proposal_1',
        status: 'completed',
      }),
    );
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'visit_schedule_reproposal_needed',
        dedupeKey: 'visit-reproposal-needed:proposal_1',
        relatedEntityType: 'visit_schedule_proposal',
        relatedEntityId: 'proposal_1',
        title: '変更希望に合わせた再提案が必要です',
        description: '患者の変更希望に合わせて候補を再生成してください。',
        priority: 'high',
        assignedTo: 'pharmacist_1',
        metadata: {
          case_id: 'case_1',
          patient_id: 'patient_1',
        },
      }),
    );
  });

  it('keeps declined contact outcomes as rejected proposals', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'pending',
      }),
    );

    const response = await PATCH(
      createRequest(
        {
          action: 'contact_attempt',
          outcome: 'declined',
          idempotency_key: 'contact-declined-1',
          contact_method: 'phone',
          note: '別候補も不要',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'proposal_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(proposalUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'proposal_1',
        org_id: 'org_1',
        proposal_status: 'patient_contact_pending',
        finalized_schedule_id: null,
      },
      data: expect.objectContaining({
        proposal_status: 'rejected',
        patient_contact_status: 'declined',
      }),
    });
    expect(contactLogCreateMock).toHaveBeenCalled();
    expect(resolveOperationalTasksMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        dedupeKey: 'visit-contact-followup:proposal_1',
        status: 'completed',
      }),
    );
  });

  it('rejects attempted or unreachable contact results without a callback due date', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'pending',
      }),
    );

    const response = await PATCH(
      createRequest(
        {
          action: 'contact_attempt',
          outcome: 'attempted',
          idempotency_key: 'contact-attempted-no-callback',
          contact_method: 'phone',
          note: '再架電不要',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'proposal_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        callback_due_at: ['未接続の場合は折返し予定日時が必須です'],
      },
    });
    expect(proposalFindFirstMock).not.toHaveBeenCalled();
    expect(proposalUpdateManyMock).not.toHaveBeenCalled();
    expect(contactLogCreateMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('creates a callback follow-up task when attempted contact includes a callback due date', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'pending',
      }),
    );

    const response = await PATCH(
      createRequest(
        {
          action: 'contact_attempt',
          outcome: 'attempted',
          idempotency_key: 'contact-attempted-callback-1',
          contact_method: 'phone',
          note: '夕方に再架電',
          callback_due_at: '2026-03-30T09:00:00.000Z',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'proposal_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'visit_contact_followup',
        title: '患者への再架電が必要です',
        description: '再架電が必要です。詳細は確定フローで確認してください。',
        assignedTo: 'pharmacist_1',
        dueDate: new Date('2026-03-30T09:00:00.000Z'),
        slaDueAt: new Date('2026-03-30T09:00:00.000Z'),
        dedupeKey: 'visit-contact-followup:proposal_1',
        relatedEntityType: 'visit_schedule_proposal',
        relatedEntityId: 'proposal_1',
        metadata: {
          case_id: 'case_1',
          patient_id: 'patient_1',
        },
      }),
    );
  });

  it('returns conflict when a stale contact attempt loses the proposal state claim', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'pending',
      }),
    );
    proposalUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await PATCH(
      createRequest(
        {
          action: 'contact_attempt',
          outcome: 'confirmed',
          idempotency_key: 'contact-stale-confirmed-1',
          contact_method: 'phone',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'proposal_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'この候補はすでに確定または変更されています。再読み込みしてください',
    });
    expect(contactLogCreateMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('does not stamp patient contact metadata when rejecting before outreach starts', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'proposed',
        patient_contact_status: 'pending',
      }),
    );

    const response = await PATCH(
      createRequest(
        {
          action: 'reject',
          reject_reason: '  東京都港区2-2-2 090-1234-5678 アムロジピン 処方詳細  ',
        },
        { 'x-org-id': 'org_1' },
      ),
      {
        params: Promise.resolve({ id: 'proposal_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(proposalUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'proposal_1',
        org_id: 'org_1',
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
        finalized_schedule_id: null,
      },
      data: {
        proposal_status: 'rejected',
        reject_reason: '東京都港区2-2-2 090-1234-5678 アムロジピン 処方詳細',
      },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'visit_schedule_proposal_rejected',
        changes: {
          proposal_status_from: 'proposed',
          proposal_status_to: 'rejected',
          patient_contact_status_from: 'pending',
          patient_contact_status_to: 'pending',
          reject_reason_recorded: true,
          reject_reason_length: '東京都港区2-2-2 090-1234-5678 アムロジピン 処方詳細'.length,
          reject_reason_storage: 'VisitScheduleProposal.reject_reason',
          reject_reason_text_stored: false,
        },
      }),
    });
    const auditPayload = JSON.stringify(auditLogCreateMock.mock.calls.at(-1)?.[0]);
    expect(auditPayload).not.toContain('東京都港区2-2-2');
    expect(auditPayload).not.toContain('090-1234-5678');
    expect(auditPayload).not.toContain('アムロジピン');
    expect(auditPayload).not.toContain('処方詳細');
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('resolves stale contact follow-up tasks when rejecting after outreach starts', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'pending',
      }),
    );

    const response = await PATCH(
      createRequest(
        {
          action: 'reject',
          reject_reason: '電話で辞退',
        },
        { 'x-org-id': 'org_1' },
      ),
      {
        params: Promise.resolve({ id: 'proposal_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(proposalUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'proposal_1',
        org_id: 'org_1',
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
        finalized_schedule_id: null,
      },
      data: expect.objectContaining({
        proposal_status: 'rejected',
        patient_contact_status: 'declined',
      }),
    });
    expect(resolveOperationalTasksMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        dedupeKey: 'visit-contact-followup:proposal_1',
        status: 'completed',
      }),
    );
  });

  it('claims proposal approval state before writing approval audit logs', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'proposed',
        patient_contact_status: 'pending',
      }),
    );

    const response = await PATCH(createRequest({ action: 'approve' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(proposalUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'proposal_1',
        org_id: 'org_1',
        proposal_status: { in: ['proposed', 'reschedule_pending'] },
        finalized_schedule_id: null,
      },
      data: expect.objectContaining({
        proposal_status: 'patient_contact_pending',
        approved_by: 'user_1',
      }),
    });
    expect(proposalUpdateManyMock.mock.calls[0][0].data.approved_at).toBeInstanceOf(Date);
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'visit_schedule_proposal_approved',
        target_type: 'VisitScheduleProposal',
      }),
    });
    expect(notifyWorkflowMutationMock).toHaveBeenCalledTimes(1);
  });

  it('returns conflict when approval loses the state claim race', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'proposed',
        patient_contact_status: 'pending',
      }),
    );
    proposalUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await PATCH(createRequest({ action: 'approve' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'この候補はすでに確定または変更されています。再読み込みしてください',
    });
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects approving a reschedule proposal when the approved override was cancelled', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'reschedule_pending',
        patient_contact_status: 'pending',
        reschedule_source_schedule_id: 'schedule_source_1',
      }),
    );
    overrideFindFirstMock.mockResolvedValueOnce({
      id: 'override_1',
      status: 'cancelled',
      approved_at: new Date('2026-03-26T10:00:00.000Z'),
    });

    const response = await PATCH(createRequest({ action: 'approve' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '確定済み訪問の変更は管理者承認後に進めてください',
    });
    expect(proposalUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it.each(['planned', 'cancelled'] as const)(
    'returns conflict when approving a reschedule proposal after the source schedule drifted to %s',
    async (sourceStatus) => {
      proposalFindFirstMock.mockResolvedValue(
        buildProposal({
          proposal_status: 'reschedule_pending',
          patient_contact_status: 'pending',
          reschedule_source_schedule_id: 'schedule_source_1',
        }),
      );
      overrideFindFirstMock.mockResolvedValueOnce({
        id: 'override_1',
        status: 'pending',
        approved_at: new Date('2026-03-26T10:00:00.000Z'),
        source_schedule: {
          schedule_status: sourceStatus,
        },
      });

      const response = await PATCH(createRequest({ action: 'approve' }, { 'x-org-id': 'org_1' }), {
        params: Promise.resolve({ id: 'proposal_1' }),
      });

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        code: 'WORKFLOW_CONFLICT',
        message: '元の訪問予定が変更済みです。再読み込みしてください',
      });
      expect(proposalUpdateManyMock).not.toHaveBeenCalled();
      expect(auditLogCreateMock).not.toHaveBeenCalled();
      expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
      expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
    },
  );

  it.each(['planned', 'cancelled'] as const)(
    'returns conflict when a reschedule source drifts to %s between approval precheck and state claim',
    async (sourceStatus) => {
      proposalFindFirstMock.mockResolvedValue(
        buildProposal({
          proposal_status: 'reschedule_pending',
          patient_contact_status: 'pending',
          reschedule_source_schedule_id: 'schedule_source_1',
        }),
      );
      overrideFindFirstMock
        .mockResolvedValueOnce({
          id: 'override_1',
          status: 'pending',
          approved_at: new Date('2026-03-26T10:00:00.000Z'),
          source_schedule: {
            schedule_status: 'rescheduled',
          },
        })
        .mockResolvedValueOnce({
          id: 'override_1',
          status: 'pending',
          approved_at: new Date('2026-03-26T10:00:00.000Z'),
          source_schedule: {
            schedule_status: sourceStatus,
          },
        });

      const response = await PATCH(createRequest({ action: 'approve' }, { 'x-org-id': 'org_1' }), {
        params: Promise.resolve({ id: 'proposal_1' }),
      });

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        code: 'WORKFLOW_CONFLICT',
        message: '元の訪問予定が変更済みです。再読み込みしてください',
      });
      expect(withOrgContextMock).toHaveBeenCalledTimes(1);
      expect(overrideFindFirstMock).toHaveBeenCalledTimes(2);
      expect(proposalUpdateManyMock).not.toHaveBeenCalled();
      expect(auditLogCreateMock).not.toHaveBeenCalled();
      expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
      expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
    },
  );

  it('keeps the reschedule source status guard on the approval state claim', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'reschedule_pending',
        patient_contact_status: 'pending',
        reschedule_source_schedule_id: 'schedule_source_1',
      }),
    );
    proposalUpdateManyMock.mockResolvedValueOnce({ count: 0 });
    overrideFindFirstMock.mockResolvedValue({
      id: 'override_1',
      status: 'pending',
      approved_at: new Date('2026-03-26T10:00:00.000Z'),
      source_schedule: {
        schedule_status: 'rescheduled',
      },
    });

    const response = await PATCH(createRequest({ action: 'approve' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'この候補はすでに確定または変更されています。再読み込みしてください',
    });
    expect(proposalUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'proposal_1',
        org_id: 'org_1',
        proposal_status: { in: ['proposed', 'reschedule_pending'] },
        finalized_schedule_id: null,
        reschedule_source_schedule_id: 'schedule_source_1',
        reschedule_source_schedule: {
          is: {
            schedule_status: 'rescheduled',
          },
        },
      },
      data: expect.objectContaining({
        proposal_status: 'patient_contact_pending',
        approved_by: 'user_1',
      }),
    });
    expect(overrideFindFirstMock).toHaveBeenCalledTimes(2);
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns conflict when rejection loses the state claim race', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
      }),
    );
    proposalUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await PATCH(createRequest({ action: 'reject' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'この候補はすでに確定または変更されています。再読み込みしてください',
    });
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('finalizes the proposal into a confirmed visit and supersedes sibling drafts', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        vehicle_resource_id: 'vehicle_1',
      }),
    );
    proposalUpdateMock.mockResolvedValueOnce(
      buildProposal({
        proposal_status: 'confirmed',
        patient_contact_status: 'confirmed',
        finalized_schedule_id: 'schedule_1',
        vehicle_resource_id: 'vehicle_1',
      }),
    );

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        alreadyFinalized: false,
        proposal: {
          proposal_status: 'confirmed',
          finalized_schedule_id: 'schedule_1',
        },
        schedule: {
          id: 'schedule_1',
        },
      },
    });
    expect(scheduleUpdateManyMock).toHaveBeenCalledOnce();
    expect(scheduleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        case_id: 'case_1',
        pharmacist_id: 'pharmacist_1',
        schedule_status: 'planned',
        vehicle_resource_id: 'vehicle_1',
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
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('rejects finalizing a reschedule proposal when the approved override was cancelled', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        reschedule_source_schedule_id: 'schedule_source_1',
      }),
    );
    overrideFindFirstMock.mockResolvedValueOnce({
      id: 'override_1',
      status: 'cancelled',
      approved_at: new Date('2026-03-26T10:00:00.000Z'),
    });

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '確定済み訪問の変更は承認後に新候補を確定してください',
    });
    expect(scheduleCreateMock).not.toHaveBeenCalled();
    expect(proposalUpdateMock).not.toHaveBeenCalled();
    expect(overrideUpdateManyMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it.each(['planned', 'cancelled'] as const)(
    'returns conflict when finalizing a reschedule proposal after the source schedule drifted to %s',
    async (sourceStatus) => {
      proposalFindFirstMock.mockResolvedValue(
        buildProposal({
          proposal_status: 'patient_contact_pending',
          patient_contact_status: 'confirmed',
          reschedule_source_schedule_id: 'schedule_source_1',
        }),
      );
      overrideFindFirstMock.mockResolvedValueOnce({
        id: 'override_1',
        status: 'pending',
        approved_at: new Date('2026-03-26T10:00:00.000Z'),
        source_schedule: {
          schedule_status: sourceStatus,
        },
      });

      const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
        params: Promise.resolve({ id: 'proposal_1' }),
      });

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        code: 'WORKFLOW_CONFLICT',
        message: '元の訪問予定が変更済みです。再読み込みしてください',
      });
      expect(proposalUpdateManyMock).not.toHaveBeenCalled();
      expect(scheduleUpdateManyMock).not.toHaveBeenCalled();
      expect(scheduleCreateMock).not.toHaveBeenCalled();
      expect(proposalUpdateMock).not.toHaveBeenCalled();
      expect(contactLogUpdateManyMock).not.toHaveBeenCalled();
      expect(overrideUpdateManyMock).not.toHaveBeenCalled();
      expect(auditLogCreateMock).not.toHaveBeenCalled();
      expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
      expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
    },
  );

  it('completes a reschedule override only while it is still pending', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        reschedule_source_schedule_id: 'schedule_source_1',
      }),
    );
    proposalUpdateMock.mockResolvedValueOnce(
      buildProposal({
        proposal_status: 'confirmed',
        patient_contact_status: 'confirmed',
        finalized_schedule_id: 'schedule_1',
        reschedule_source_schedule_id: 'schedule_source_1',
      }),
    );

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(overrideUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        source_schedule_id: 'schedule_source_1',
        status: 'pending',
        approved_at: { not: null },
        source_schedule: {
          is: {
            schedule_status: 'rescheduled',
          },
        },
      },
      data: expect.objectContaining({
        status: 'completed',
        replacement_schedule_id: 'schedule_1',
      }),
    });
    expect(overrideUpdateMock).not.toHaveBeenCalled();
  });

  it('returns conflict when reschedule override completion loses the state race', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        reschedule_source_schedule_id: 'schedule_source_1',
      }),
    );
    overrideUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '確定済み訪問の変更承認が同時に更新されました。再読み込みしてください',
    });
    expect(overrideUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        source_schedule_id: 'schedule_source_1',
        status: 'pending',
        approved_at: { not: null },
        source_schedule: {
          is: {
            schedule_status: 'rescheduled',
          },
        },
      },
      data: expect.objectContaining({
        status: 'completed',
        replacement_schedule_id: 'schedule_1',
      }),
    });
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects proposal finalization when billing caps are exceeded at confirmation time', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
      }),
    );
    patientInsuranceFindFirstMock.mockImplementation(async ({ where }) =>
      where.insurance_type === 'medical' ? { number: 'medical_1' } : null,
    );
    scheduleCountMock.mockResolvedValueOnce(4).mockResolvedValue(0);

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('月上限4回を超過します'),
    });
    expect(scheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('does not count sibling proposals that confirmation will supersede against billing caps', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
      }),
    );
    patientInsuranceFindFirstMock.mockImplementation(async ({ where }) =>
      where.insurance_type === 'medical' ? { number: 'medical_1' } : null,
    );
    scheduleCountMock.mockResolvedValueOnce(3).mockResolvedValue(0);
    proposalFindManyMock.mockResolvedValueOnce([
      {
        id: 'proposal_sibling',
        case_id: 'case_1',
        proposal_batch_id: 'batch_1',
        proposed_date: new Date('2026-03-28T00:00:00.000Z'),
        proposed_pharmacist_id: 'pharmacist_1',
        visit_type: 'regular',
        finalized_schedule_id: null,
        reschedule_source_schedule_id: null,
        case_: {
          patient_id: 'patient_1',
        },
      },
    ]);

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(scheduleCreateMock).toHaveBeenCalledTimes(1);
    expect(proposalUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        case_id: 'case_1',
        id: { not: 'proposal_1' },
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
        reschedule_source_schedule_id: null,
      },
      data: {
        proposal_status: 'superseded',
      },
    });
    expect(notifyWorkflowMutationMock).toHaveBeenCalledTimes(1);
  });

  it('rejects confirmation on a closed operating day when the proposal has no override reason', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
      }),
    );
    pharmacyOperatingHoursFindManyMock.mockResolvedValueOnce([
      {
        id: 'hours_fri_closed',
        site_id: 'site_1',
        weekday: 5,
        is_open: false,
        open_time: null,
        close_time: null,
        note: null,
      },
    ]);
    auditLogFindFirstMock.mockResolvedValueOnce(null);

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message:
        '2026-03-27: 訪問拠点が定休日のため訪問候補を確定できません。休業日上書き理由を入力して候補を再生成してください',
    });
    expect(proposalUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleCreateMock).not.toHaveBeenCalled();
  });

  it('carries operating-day override reasons into the finalized schedule audit trail', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
      }),
    );
    proposalUpdateMock.mockResolvedValueOnce(
      buildProposal({
        proposal_status: 'confirmed',
        patient_contact_status: 'confirmed',
        finalized_schedule_id: 'schedule_1',
      }),
    );
    pharmacyOperatingHoursFindManyMock.mockResolvedValueOnce([
      {
        id: 'hours_fri_closed',
        site_id: 'site_1',
        weekday: 5,
        is_open: false,
        open_time: null,
        close_time: null,
        note: null,
      },
    ]);
    auditLogFindFirstMock.mockResolvedValueOnce({
      changes: {
        operating_day_override_reason: '患者都合により定休日対応',
      },
    });

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'visit_schedule_operating_day_override_applied',
        target_type: 'VisitSchedule',
        target_id: 'schedule_1',
        patient_id: 'patient_1',
        changes: expect.objectContaining({
          case_id: 'case_1',
          cycle_id: 'cycle_1',
          proposal_id: 'proposal_1',
          scheduled_date: '2026-03-27',
          pharmacist_id: 'pharmacist_1',
          site_id: 'site_1',
          operating_day_reason: 'regular_closed',
          override_reason: '患者都合により定休日対応',
        }),
      }),
    });
  });

  it('creates the visit from the transaction-time proposal snapshot after the confirmation claim', async () => {
    const outerSnapshot = buildProposal({
      proposal_status: 'patient_contact_pending',
      patient_contact_status: 'confirmed',
      proposed_date: new Date('2026-03-27T00:00:00.000Z'),
      proposed_pharmacist_id: 'pharmacist_old',
      time_window_start: new Date('1970-01-01T09:00:00.000Z'),
      time_window_end: new Date('1970-01-01T10:00:00.000Z'),
      route_order: 1,
    });
    const transactionSnapshot = buildProposal({
      proposal_status: 'patient_contact_pending',
      patient_contact_status: 'confirmed',
      proposed_date: new Date('2026-03-29T00:00:00.000Z'),
      proposed_pharmacist_id: 'pharmacist_latest',
      time_window_start: new Date('1970-01-01T13:00:00.000Z'),
      time_window_end: new Date('1970-01-01T14:00:00.000Z'),
      priority: 'urgent',
      assignment_mode: 'fallback',
      route_order: 3,
    });
    proposalFindFirstMock
      .mockResolvedValueOnce(outerSnapshot)
      .mockResolvedValueOnce(transactionSnapshot)
      .mockResolvedValueOnce(transactionSnapshot);
    proposalUpdateMock.mockResolvedValueOnce(
      buildProposal({
        ...transactionSnapshot,
        proposal_status: 'confirmed',
        finalized_schedule_id: 'schedule_1',
      }),
    );

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(evaluateVisitWorkflowGateMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        caseId: 'case_1',
        asOf: new Date('2026-03-29T00:00:00.000Z'),
      }),
    );
    expect(pharmacistShiftFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        user_id: 'pharmacist_latest',
        date: new Date('2026-03-29T00:00:00.000Z'),
      },
      select: {
        site_id: true,
        available: true,
        available_from: true,
        available_to: true,
      },
    });
    expect(scheduleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scheduled_date: new Date('2026-03-29T00:00:00.000Z'),
        time_window_start: new Date('1970-01-01T13:00:00.000Z'),
        time_window_end: new Date('1970-01-01T14:00:00.000Z'),
        pharmacist_id: 'pharmacist_latest',
        priority: 'urgent',
        assignment_mode: 'fallback',
      }),
    });
    expect(scheduleCreateMock.mock.calls[0]?.[0]?.data).not.toMatchObject({
      scheduled_date: new Date('2026-03-27T00:00:00.000Z'),
      pharmacist_id: 'pharmacist_old',
    });
  });

  it('returns a conflict when the proposal state changes before the confirmation claim', async () => {
    proposalFindFirstMock
      .mockResolvedValueOnce(
        buildProposal({
          proposal_status: 'patient_contact_pending',
          patient_contact_status: 'confirmed',
          finalized_schedule_id: null,
        }),
      )
      .mockResolvedValueOnce({
        proposal_status: 'superseded',
        patient_contact_status: 'confirmed',
        finalized_schedule_id: null,
      });

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'この候補はすでに確定または変更されています。再読み込みしてください',
    });
    expect(scheduleCreateMock).not.toHaveBeenCalled();
    expect(proposalUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('retries serializable confirm conflicts and rejects when vehicle capacity is full on retry', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        vehicle_resource_id: 'vehicle_1',
      }),
    );
    vehicleResourceFindFirstMock.mockResolvedValue({
      site_id: 'site_1',
      label: '社用車A',
      max_stops: 1,
    });
    scheduleCountMock.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    proposalUpdateManyMock.mockRejectedValueOnce(buildSerializableConflictError());

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '社用車A で訪問できる件数は最大 1 件です',
    });
    expect(withOrgContextMock).toHaveBeenCalledTimes(2);
    expect(withOrgContextMock).toHaveBeenNthCalledWith(1, 'org_1', expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(withOrgContextMock).toHaveBeenNthCalledWith(2, 'org_1', expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(scheduleCountMock).toHaveBeenCalledTimes(2);
    expect(proposalUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(scheduleCreateMock).not.toHaveBeenCalled();
    expect(scheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('retries serializable confirm conflicts and recalculates route order from retry-time schedules', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        route_order: 1,
      }),
    );
    scheduleFindManyMock
      .mockResolvedValueOnce([
        {
          route_order: 1,
        },
      ])
      .mockResolvedValueOnce([
        {
          route_order: 3,
        },
      ]);
    scheduleUpdateManyMock
      .mockRejectedValueOnce(buildSerializableConflictError())
      .mockResolvedValueOnce({ count: 1 });
    scheduleCreateMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      route_order: 4,
    });
    proposalUpdateMock.mockResolvedValueOnce(
      buildProposal({
        proposal_status: 'confirmed',
        patient_contact_status: 'confirmed',
        finalized_schedule_id: 'schedule_1',
        route_order: 4,
      }),
    );

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(withOrgContextMock).toHaveBeenCalledTimes(2);
    expect(scheduleFindManyMock).toHaveBeenCalledTimes(2);
    expect(scheduleUpdateManyMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          route_order: {
            gte: 2,
          },
        }),
      }),
    );
    expect(scheduleUpdateManyMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          route_order: {
            gte: 4,
          },
        }),
      }),
    );
    expect(scheduleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        route_order: 4,
      }),
    });
    expect(proposalUpdateMock).toHaveBeenCalledWith({
      where: { id: 'proposal_1' },
      data: expect.objectContaining({
        route_order: 4,
      }),
    });
    expect(notifyWorkflowMutationMock).toHaveBeenCalledTimes(1);
  });

  it('returns a conflict when serializable confirm conflicts exceed the retry limit', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
      }),
    );
    proposalUpdateManyMock.mockRejectedValue(buildSerializableConflictError());

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '訪問候補の確定が同時に更新されました。再読み込みしてください',
    });
    expect(withOrgContextMock).toHaveBeenCalledTimes(3);
    expect(scheduleCreateMock).not.toHaveBeenCalled();
    expect(proposalUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('does not create a duplicate visit when another confirmation wins the claim race', async () => {
    proposalFindFirstMock
      .mockResolvedValueOnce(
        buildProposal({
          proposal_status: 'patient_contact_pending',
          patient_contact_status: 'confirmed',
          finalized_schedule_id: null,
        }),
      )
      .mockResolvedValueOnce(
        buildProposal({
          proposal_status: 'patient_contact_pending',
          patient_contact_status: 'confirmed',
          finalized_schedule_id: null,
        }),
      )
      .mockResolvedValueOnce({
        proposal_status: 'confirmed',
        patient_contact_status: 'confirmed',
        finalized_schedule_id: 'schedule_existing',
      });
    proposalUpdateManyMock.mockResolvedValueOnce({ count: 0 });
    scheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_existing',
      org_id: 'org_1',
      case_id: 'case_1',
    });

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        schedule: {
          id: 'schedule_existing',
        },
        alreadyFinalized: true,
      },
    });
    expect(proposalUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(proposalUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'proposal_1',
        org_id: 'org_1',
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        finalized_schedule_id: null,
      },
      data: {
        confirmed_at: expect.any(Date),
        confirmed_by: 'user_1',
      },
    });
    expect(scheduleCreateMock).not.toHaveBeenCalled();
    expect(scheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(proposalUpdateMock).not.toHaveBeenCalled();
    expect(contactLogUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).toHaveBeenCalledTimes(1);
  });

  it('does not shift locked route orders when confirming a stale early proposal order', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        priority: 'emergency',
        route_order: 1,
      }),
    );
    scheduleFindManyMock.mockResolvedValueOnce([
      {
        route_order: 1,
      },
    ]);

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(scheduleFindManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        org_id: 'org_1',
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-03-27T00:00:00.000Z'),
        route_order: {
          not: null,
        },
        OR: [
          { confirmed_at: { not: null } },
          { schedule_status: { in: ['ready', 'departed', 'in_progress', 'completed'] } },
        ],
      }),
      select: {
        route_order: true,
      },
    });
    expect(scheduleUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        route_order: {
          gte: 2,
        },
      }),
      data: {
        route_order: {
          increment: 1,
        },
      },
    });
    expect(scheduleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        route_order: 2,
      }),
    });
    expect(proposalUpdateMock).toHaveBeenCalledWith({
      where: { id: 'proposal_1' },
      data: expect.objectContaining({
        proposal_status: 'confirmed',
        route_order: 2,
      }),
    });
  });

  it('finalizes after remaining open proposal route orders while ignoring siblings that will be superseded', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        route_order: 1,
      }),
    );
    scheduleFindManyMock.mockResolvedValueOnce([]);
    proposalFindManyMock.mockResolvedValueOnce([
      {
        route_order: 4,
      },
    ]);

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(proposalFindManyMock).toHaveBeenCalledWith({
      where: {
        id: {
          not: 'proposal_1',
        },
        org_id: 'org_1',
        proposed_pharmacist_id: 'pharmacist_1',
        proposed_date: new Date('2026-03-27T00:00:00.000Z'),
        finalized_schedule_id: null,
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
        route_order: {
          not: null,
        },
        NOT: {
          case_id: 'case_1',
          reschedule_source_schedule_id: null,
        },
      },
      select: {
        route_order: true,
      },
    });
    expect(scheduleUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        route_order: {
          gte: 5,
        },
      }),
      data: {
        route_order: {
          increment: 1,
        },
      },
    });
    expect(scheduleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        route_order: 5,
      }),
    });
    expect(proposalUpdateMock).toHaveBeenCalledWith({
      where: { id: 'proposal_1' },
      data: expect.objectContaining({
        proposal_status: 'confirmed',
        route_order: 5,
      }),
    });
  });

  it('rejects proposal confirmation when the selected pharmacist shift is missing', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
      }),
    );
    pharmacistShiftFindFirstMock.mockResolvedValueOnce(null);

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '選択した薬剤師のシフトがありません',
    });
    expect(scheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleCreateMock).not.toHaveBeenCalled();
    expect(proposalUpdateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ proposal_status: 'confirmed' }),
      }),
    );
  });

  it('rejects proposal confirmation when the selected pharmacist shift no longer covers the time window', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
      }),
    );
    pharmacistShiftFindFirstMock.mockResolvedValueOnce({
      site_id: 'site_1',
      available: true,
      available_from: new Date('1970-01-01T09:30:00.000Z'),
      available_to: new Date('1970-01-01T17:30:00.000Z'),
    });

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '訪問開始時刻が薬剤師シフトの開始前です',
    });
    expect(scheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects proposal confirmation when the selected vehicle resource is unavailable', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        vehicle_resource_id: 'vehicle_1',
      }),
    );
    vehicleResourceFindFirstMock.mockResolvedValueOnce(null);

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '選択した車両リソースが見つからないか利用できません',
    });
    expect(scheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects proposal confirmation when the selected vehicle belongs to another site', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        vehicle_resource_id: 'vehicle_2',
      }),
    );
    vehicleResourceFindFirstMock.mockResolvedValueOnce({
      site_id: 'site_2',
      label: '社用車B',
      max_stops: 8,
    });

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '選択した車両リソースは訪問予定の拠点では利用できません',
    });
    expect(scheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects proposal confirmation when the selected vehicle reaches same-day capacity after proposal generation', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        vehicle_resource_id: 'vehicle_1',
      }),
    );
    vehicleResourceFindFirstMock.mockResolvedValueOnce({
      site_id: 'site_1',
      label: '社用車A',
      max_stops: 1,
    });
    scheduleCountMock.mockResolvedValueOnce(1);

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '社用車A で訪問できる件数は最大 1 件です',
    });
    expect(scheduleCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        vehicle_resource_id: 'vehicle_1',
        scheduled_date: new Date('2026-03-27T00:00:00.000Z'),
        schedule_status: {
          notIn: ['cancelled', 'rescheduled'],
        },
      },
    });
    expect(scheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects proposal confirmation when the pharmacist time window overlaps an active schedule', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
      }),
    );
    scheduleFindFirstMock.mockResolvedValueOnce({ id: 'schedule_overlap' });

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同一薬剤師・同一日付の訪問時間帯が既存予定と重複しています。再読み込みしてください',
    });
    expect(scheduleFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        org_id: 'org_1',
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-03-27T00:00:00.000Z'),
        schedule_status: {
          in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
        },
        time_window_start: { lt: new Date('1970-01-01T10:00:00.000Z') },
        time_window_end: { gt: new Date('1970-01-01T09:00:00.000Z') },
      }),
      select: { id: true },
    });
    expect(scheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects proposal confirmation when the selected vehicle time window overlaps an active schedule', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        vehicle_resource_id: 'vehicle_1',
      }),
    );
    scheduleFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'schedule_vehicle_overlap',
    });

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同一車両・同一日付の訪問時間帯が既存予定と重複しています。再読み込みしてください',
    });
    expect(scheduleFindFirstMock).toHaveBeenNthCalledWith(2, {
      where: expect.objectContaining({
        org_id: 'org_1',
        vehicle_resource_id: 'vehicle_1',
        scheduled_date: new Date('2026-03-27T00:00:00.000Z'),
        schedule_status: {
          in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
        },
        time_window_start: { lt: new Date('1970-01-01T10:00:00.000Z') },
        time_window_end: { gt: new Date('1970-01-01T09:00:00.000Z') },
      }),
      select: { id: true },
    });
    expect(scheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects proposal confirmation when an active schedule for the same case/date already exists', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
      }),
    );
    scheduleFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'schedule_duplicate',
    });

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同一ケース・同一日付の訪問予定が既に存在します。既存予定を確認してください',
    });
    expect(scheduleFindFirstMock).toHaveBeenNthCalledWith(2, {
      where: {
        org_id: 'org_1',
        case_id: 'case_1',
        visit_type: 'regular',
        scheduled_date: new Date('2026-03-27T00:00:00.000Z'),
        schedule_status: { notIn: ['cancelled', 'rescheduled'] },
      },
      select: { id: true },
    });
    expect(scheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleCreateMock).not.toHaveBeenCalled();
    expect(proposalUpdateMock).not.toHaveBeenCalled();
    expect(contactLogUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('excludes the reschedule source schedule from proposal confirmation overlap checks', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        reschedule_source_schedule_id: 'schedule_source',
      }),
    );
    scheduleFindFirstMock.mockResolvedValueOnce(null);

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(scheduleFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        org_id: 'org_1',
        id: { not: 'schedule_source' },
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-03-27T00:00:00.000Z'),
        time_window_start: { lt: new Date('1970-01-01T10:00:00.000Z') },
        time_window_end: { gt: new Date('1970-01-01T09:00:00.000Z') },
      }),
      select: { id: true },
    });
    expect(scheduleCreateMock).toHaveBeenCalled();
  });

  it('copies a suggested recurrence rule into the finalized visit schedule', async () => {
    proposalFindFirstMock.mockResolvedValue(
      buildProposal({
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        suggested_recurrence_rule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU',
      }),
    );

    const response = await PATCH(createRequest({ action: 'confirm' }, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'proposal_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(scheduleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU',
      }),
    });
  });
});
