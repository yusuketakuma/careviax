import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const { authMock, prismaMock, withOrgContextMock, txMock } = vi.hoisted(() => {
  const createRecord = () => ({
    id: 'entity_1',
    status: 'active',
    version: 1,
    overall_status: 'ready_to_dispense',
    cycle_id: 'cycle_1',
    plan_id: 'plan_1',
    line_id: 'line_1',
    patient_id: 'patient_1',
    case_id: 'case_1',
    site_id: 'site_1',
    pharmacist_id: 'user_1',
    vehicle_resource_id: null,
    scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
    schedule_status: 'planned',
    confirmed_at: null,
    recurrence_rule: null,
    role: 'admin',
    proposal_status: 'proposed',
    proposed_pharmacist_id: 'user_1',
    proposed_date: new Date('2026-03-26T00:00:00.000Z'),
    time_window_start: new Date('1970-01-01T09:00:00.000Z'),
    time_window_end: new Date('1970-01-01T10:00:00.000Z'),
    visit_type: 'regular',
    priority: 'normal',
    assignment_mode: 'primary',
    route_order: 1,
    medication_end_date: null,
    visit_deadline_date: null,
    escalation_reason: null,
    finalized_schedule_id: null,
    target_period_start: new Date('2026-04-01T00:00:00.000Z'),
    target_period_end: new Date('2026-04-07T00:00:00.000Z'),
    set_method: 'custom',
    notes: null,
    packaging_method_id: null,
    updated_at: new Date('2026-06-18T00:00:00.000Z'),
    cycle: {
      overall_status: 'ready_to_dispense',
      prescription_intakes: [],
      case_: {
        patient: {
          packaging_profile: null,
        },
      },
    },
    plan: {
      cycle: {
        overall_status: 'setting',
      },
    },
    schedule: {
      case_id: 'case_1',
      pharmacist_id: 'user_1',
      visit_type: 'regular',
      case_: {
        primary_pharmacist_id: 'user_1',
        backup_pharmacist_id: null,
        required_visit_support: null,
      },
    },
    case_: {
      primary_pharmacist_id: 'user_1',
      backup_pharmacist_id: null,
      patient: {
        scheduling_preference: null,
        residences: [
          {
            address: '東京都千代田区1-1-1',
            lat: null,
            lng: null,
            facility: null,
          },
        ],
      },
    },
  });

  const createModel = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(createRecord()),
    findUnique: vi.fn().mockResolvedValue(createRecord()),
    count: vi.fn().mockResolvedValue(0),
    groupBy: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(createRecord()),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    upsert: vi.fn().mockResolvedValue(createRecord()),
    delete: vi.fn().mockResolvedValue(createRecord()),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    create: vi.fn().mockResolvedValue(createRecord()),
    createMany: vi.fn().mockResolvedValue({ count: 1 }),
  });

  const createDbProxy = () => {
    const cache = new Map<PropertyKey, ReturnType<typeof createModel>>();
    const queryRaw = vi.fn().mockResolvedValue([{ first_value: BigInt(1) }]);
    return new Proxy(
      {},
      {
        get: (_target, prop: PropertyKey) => {
          if (prop === '$queryRaw') return queryRaw;
          if (prop === '$transaction') return vi.fn(async (callback) => callback(createDbProxy()));
          if (!cache.has(prop)) {
            cache.set(prop, createModel());
          }
          return cache.get(prop);
        },
      },
    );
  };

  type DbProxy = Record<string, ReturnType<typeof createModel>>;

  return {
    authMock: vi.fn(),
    prismaMock: createDbProxy() as DbProxy,
    txMock: createDbProxy() as DbProxy,
    withOrgContextMock: vi.fn(),
  };
});

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { PATCH as casePatch } from '../cases/[id]/route';
import { PATCH as caseTransitionPatch } from '../cases/[id]/transition/route';
import { PATCH as careReportPatch } from '../care-reports/[id]/route';
import { PATCH as patientSelfReportPatch } from '../patient-self-reports/[id]/route';
import { PATCH as communicationRequestPatch } from '../communication-requests/[id]/route';
import {
  DELETE as documentDeliveryRuleDelete,
  PATCH as documentDeliveryRulePatch,
} from '../document-delivery-rules/[id]/route';
import { PATCH as inquiryRecordPatch } from '../inquiry-records/[id]/route';
import { PATCH as firstVisitDocumentPatch } from '../first-visit-documents/[id]/route';
import { PATCH as medicationCycleTransitionPatch } from '../medication-cycles/[id]/transition/route';
import { PATCH as medicationIssuePatch } from '../medication-issues/[id]/route';
import { PATCH as billingCandidatePatch } from '../billing-candidates/[id]/route';
import { PATCH as notificationsPatch } from '../notifications/route';
import { PATCH as patientPatch } from '../patients/[id]/route';
import { DELETE as pcaPumpDelete, PATCH as pcaPumpPatch } from '../pca-pumps/[id]/route';
import { PATCH as prescriptionIntakePatch } from '../prescription-intakes/[id]/route';
import { PATCH as setBatchPatch, DELETE as setBatchDelete } from '../set-batches/[id]/route';
import { PATCH as setPlanPatch } from '../set-plans/[id]/route';
import { PATCH as visitRecordPatch } from '../visit-records/[id]/route';
import { PATCH as visitScheduleProposalPatch } from '../visit-schedule-proposals/[id]/route';
import {
  PATCH as visitSchedulePatch,
  DELETE as visitScheduleDelete,
} from '../visit-schedules/[id]/route';
import { PATCH as auditLogReviewPatch } from '../audit-logs/[id]/review/route';

type Handler = () => Promise<Response | undefined>;
type RouteEntry = { name: string; handler: Handler; successBody?: unknown };
const emptyRouteContext = { params: Promise.resolve({}) };

function createRequest(url: string, headers?: Record<string, string>, body?: unknown) {
  return new NextRequest(url, {
    method: 'PATCH',
    body: JSON.stringify(body ?? {}),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

function createDeleteRequest(url: string, headers?: Record<string, string>) {
  return new NextRequest(url, {
    method: 'DELETE',
    headers: {
      ...headers,
    },
  });
}

function routeShouldBeNoStore(routeName: string) {
  return (
    routeName === 'set-batches/[id] PATCH' ||
    routeName === 'set-batches/[id] DELETE' ||
    routeName === 'set-plans/[id] PATCH' ||
    routeName === 'document-delivery-rules/[id] PATCH' ||
    routeName === 'document-delivery-rules/[id] DELETE' ||
    routeName === 'audit-logs/[id]/review PATCH' ||
    routeName === 'pca-pumps/[id] PATCH' ||
    routeName === 'pca-pumps/[id] DELETE'
  );
}

const permissionRoutes: RouteEntry[] = [
  {
    name: 'cases/[id] PATCH',
    handler: () =>
      casePatch(createRequest('http://localhost/api/cases/case_1', { 'x-org-id': 'org_1' }, {}), {
        params: Promise.resolve({ id: 'case_1' }),
      }),
  },
  {
    name: 'cases/[id]/transition PATCH',
    handler: () =>
      caseTransitionPatch(
        createRequest(
          'http://localhost/api/cases/case_1/transition',
          { 'x-org-id': 'org_1' },
          { from: 'active', to: 'on_hold' },
        ),
        { params: Promise.resolve({ id: 'case_1' }) },
      ),
  },
  {
    name: 'care-reports/[id] PATCH',
    handler: () =>
      careReportPatch(
        createRequest(
          'http://localhost/api/care-reports/report_1',
          { 'x-org-id': 'org_1' },
          { expected_updated_at: '2026-06-18T00:00:00.000Z' },
        ),
        { params: Promise.resolve({ id: 'report_1' }) },
      ),
  },
  {
    name: 'patient-self-reports/[id] PATCH',
    handler: () =>
      patientSelfReportPatch(
        createRequest(
          'http://localhost/api/patient-self-reports/report_1',
          { 'x-org-id': 'org_1' },
          { status: 'resolved', updated_at: '2026-06-18T00:00:00.000Z' },
        ),
        { params: Promise.resolve({ id: 'report_1' }) },
      ),
  },
  {
    name: 'billing-candidates/[id] PATCH',
    handler: () =>
      billingCandidatePatch(
        createRequest(
          'http://localhost/api/billing-candidates/candidate_1',
          { 'x-org-id': 'org_1' },
          { action: 'confirm', expected_updated_at: '2026-06-18T00:00:00.000Z' },
        ),
        { params: Promise.resolve({ id: 'candidate_1' }) },
      ),
    successBody: { action: 'confirm', expected_updated_at: '2026-06-18T00:00:00.000Z' },
  },
  {
    name: 'communication-requests/[id] PATCH',
    handler: () =>
      communicationRequestPatch(
        createRequest(
          'http://localhost/api/communication-requests/request_1',
          { 'x-org-id': 'org_1' },
          { expected_updated_at: '2026-06-18T00:00:00.000Z' },
        ),
        { params: Promise.resolve({ id: 'request_1' }) },
      ),
  },
  {
    name: 'audit-logs/[id]/review PATCH',
    handler: () =>
      auditLogReviewPatch(
        createRequest(
          'http://localhost/api/audit-logs/audit_1/review',
          { 'x-org-id': 'org_1' },
          { review_state: 'reviewed', reason_code: 'admin_reviewed' },
        ),
        { params: Promise.resolve({ id: 'audit_1' }) },
      ),
  },
  {
    name: 'document-delivery-rules/[id] PATCH',
    handler: () =>
      documentDeliveryRulePatch(
        createRequest(
          'http://localhost/api/document-delivery-rules/rule_1',
          { 'x-org-id': 'org_1' },
          { channel: 'fax' },
        ),
        { params: Promise.resolve({ id: 'rule_1' }) },
      ),
  },
  {
    name: 'document-delivery-rules/[id] DELETE',
    handler: () =>
      documentDeliveryRuleDelete(
        createDeleteRequest('http://localhost/api/document-delivery-rules/rule_1', {
          'x-org-id': 'org_1',
        }),
        { params: Promise.resolve({ id: 'rule_1' }) },
      ),
  },
  {
    name: 'inquiry-records/[id] PATCH',
    handler: () =>
      inquiryRecordPatch(
        createRequest(
          'http://localhost/api/inquiry-records/inquiry_1',
          { 'x-org-id': 'org_1' },
          {},
        ),
        { params: Promise.resolve({ id: 'inquiry_1' }) },
      ),
  },
  {
    name: 'first-visit-documents/[id] PATCH',
    handler: () =>
      firstVisitDocumentPatch(
        createRequest(
          'http://localhost/api/first-visit-documents/doc_1',
          { 'x-org-id': 'org_1' },
          { delivered_to: '山田太郎' },
        ),
        { params: Promise.resolve({ id: 'doc_1' }) },
      ),
  },
  {
    name: 'medication-cycles/[id]/transition PATCH',
    handler: () =>
      medicationCycleTransitionPatch(
        createRequest(
          'http://localhost/api/medication-cycles/cycle_1/transition',
          { 'x-org-id': 'org_1' },
          { to: 'dispensing', version: 1 },
        ),
        { params: Promise.resolve({ id: 'cycle_1' }) },
      ),
  },
  {
    name: 'medication-issues/[id] PATCH',
    handler: () =>
      medicationIssuePatch(
        createRequest(
          'http://localhost/api/medication-issues/issue_1',
          { 'x-org-id': 'org_1' },
          {},
        ),
        { params: Promise.resolve({ id: 'issue_1' }) },
      ),
  },
  {
    name: 'patients/[id] PATCH',
    handler: () =>
      patientPatch(
        createRequest('http://localhost/api/patients/patient_1', { 'x-org-id': 'org_1' }, {}),
        { params: Promise.resolve({ id: 'patient_1' }) },
      ),
  },
  {
    name: 'pca-pumps/[id] PATCH',
    handler: () =>
      pcaPumpPatch(
        createRequest(
          'http://localhost/api/pca-pumps/pump_1',
          { 'x-org-id': 'org_1' },
          { status: 'maintenance' },
        ),
        { params: Promise.resolve({ id: 'pump_1' }) },
      ),
  },
  {
    name: 'pca-pumps/[id] DELETE',
    handler: () =>
      pcaPumpDelete(
        createDeleteRequest('http://localhost/api/pca-pumps/pump_1', { 'x-org-id': 'org_1' }),
        { params: Promise.resolve({ id: 'pump_1' }) },
      ),
  },
  {
    name: 'prescription-intakes/[id] PATCH',
    handler: () =>
      prescriptionIntakePatch(
        createRequest(
          'http://localhost/api/prescription-intakes/intake_1',
          { 'x-org-id': 'org_1' },
          {},
        ),
        { params: Promise.resolve({ id: 'intake_1' }) },
      ),
  },
  {
    name: 'set-batches/[id] PATCH',
    handler: () =>
      setBatchPatch(
        createRequest(
          'http://localhost/api/set-batches/batch_1',
          { 'x-org-id': 'org_1' },
          { quantity: 2, version: 1 },
        ),
        { params: Promise.resolve({ id: 'batch_1' }) },
      ),
  },
  {
    name: 'set-batches/[id] DELETE',
    handler: () =>
      setBatchDelete(
        createDeleteRequest('http://localhost/api/set-batches/batch_1?version=1', {
          'x-org-id': 'org_1',
        }),
        { params: Promise.resolve({ id: 'batch_1' }) },
      ),
  },
  {
    name: 'set-plans/[id] PATCH',
    handler: () =>
      setPlanPatch(
        createRequest(
          'http://localhost/api/set-plans/plan_1',
          { 'x-org-id': 'org_1' },
          {
            expected_updated_at: '2026-06-18T00:00:00.000Z',
            set_method: 'custom',
          },
        ),
        { params: Promise.resolve({ id: 'plan_1' }) },
      ),
  },
  {
    name: 'visit-records/[id] PATCH',
    handler: () =>
      visitRecordPatch(
        createRequest(
          'http://localhost/api/visit-records/record_1',
          { 'x-org-id': 'org_1' },
          { version: 1 },
        ),
        { params: Promise.resolve({ id: 'record_1' }) },
      ),
  },
  {
    name: 'visit-schedule-proposals/[id] PATCH',
    handler: () =>
      visitScheduleProposalPatch(
        createRequest(
          'http://localhost/api/visit-schedule-proposals/proposal_1',
          { 'x-org-id': 'org_1' },
          { action: 'approve' },
        ),
        { params: Promise.resolve({ id: 'proposal_1' }) },
      ),
  },
  {
    name: 'visit-schedules/[id] PATCH',
    handler: () =>
      visitSchedulePatch(
        createRequest(
          'http://localhost/api/visit-schedules/schedule_1',
          { 'x-org-id': 'org_1' },
          {},
        ),
        { params: Promise.resolve({ id: 'schedule_1' }) },
      ),
  },
  {
    name: 'visit-schedules/[id] DELETE',
    handler: () =>
      visitScheduleDelete(
        createRequest('http://localhost/api/visit-schedules/schedule_1', { 'x-org-id': 'org_1' }),
        { params: Promise.resolve({ id: 'schedule_1' }) },
      ),
  },
];

describe('protected PATCH/DELETE routes auth matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.patient.findFirst.mockResolvedValue({ id: 'patient_1' });
    prismaMock.careCase.findFirst.mockResolvedValue({
      id: 'case_1',
      patient_id: 'patient_1',
      status: 'active',
      primary_pharmacist_id: 'user_1',
      backup_pharmacist_id: null,
    });
    txMock.pcaPump.findFirst.mockResolvedValue({
      id: 'pump_1',
      asset_code: 'PCA-001',
      serial_number: null,
      model_name: 'CADD Legacy PCA',
      manufacturer: null,
      status: 'available',
      maintenance_due_at: null,
      notes: null,
      created_at: new Date('2026-06-18T00:00:00.000Z'),
      updated_at: new Date('2026-06-18T00:00:00.000Z'),
      rentals: [],
      _count: { rentals: 0 },
    });
    // 34211256 以降 PATCH は楽観 updateMany claim → 再取得の流れ(claim.count 検査)
    txMock.pcaPump.updateMany.mockResolvedValue({ count: 1 });
    txMock.pcaPump.update.mockResolvedValue({
      id: 'pump_1',
      asset_code: 'PCA-001',
      serial_number: null,
      model_name: 'CADD Legacy PCA',
      manufacturer: null,
      status: 'maintenance',
      maintenance_due_at: null,
      notes: null,
      created_at: new Date('2026-06-18T00:00:00.000Z'),
      updated_at: new Date('2026-06-18T00:00:00.000Z'),
    });
    txMock.pcaPump.delete.mockResolvedValue({
      id: 'pump_1',
      status: 'maintenance',
      created_at: new Date('2026-06-18T00:00:00.000Z'),
      updated_at: new Date('2026-06-18T00:00:00.000Z'),
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(txMock));
  });

  for (const route of permissionRoutes) {
    it(`${route.name} returns 401 when unauthenticated`, async () => {
      authMock.mockResolvedValue(null);

      const response = await route.handler();

      expect(response).toBeDefined();
      if (!response) throw new Error('response is required');
      expect(response.status).toBe(401);
      if (routeShouldBeNoStore(route.name)) {
        expectNoStore(response);
      }
    });

    it(`${route.name} returns 403 when role lacks permission`, async () => {
      authMock.mockResolvedValue({ user: { id: 'user_1' } });
      prismaMock.membership.findFirst.mockResolvedValue({ role: 'driver' });

      const response = await route.handler();

      expect(response).toBeDefined();
      if (!response) throw new Error('response is required');
      expect(response.status).toBe(403);
      if (routeShouldBeNoStore(route.name)) {
        expectNoStore(response);
      }
    });

    it(`${route.name} returns 200 when role has permission`, async () => {
      authMock.mockResolvedValue({ user: { id: 'user_1' } });
      prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });

      const response = await route.handler();

      expect(response).toBeDefined();
      if (!response) throw new Error('response is required');
      expect(response.status).toBe(200);
      if (routeShouldBeNoStore(route.name)) {
        expectNoStore(response);
      }
    });
  }

  it('inquiry-records/[id] PATCH returns 401 with no-store when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const response = await inquiryRecordPatch(
      createRequest('http://localhost/api/inquiry-records/inquiry_1', { 'x-org-id': 'org_1' }, {}),
      { params: Promise.resolve({ id: 'inquiry_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(401);
    expectNoStore(response);
  });

  it('inquiry-records/[id] PATCH returns 403 with no-store when role lacks permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'driver' });

    const response = await inquiryRecordPatch(
      createRequest('http://localhost/api/inquiry-records/inquiry_1', { 'x-org-id': 'org_1' }, {}),
      { params: Promise.resolve({ id: 'inquiry_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectNoStore(response);
  });

  it('inquiry-records/[id] PATCH returns 200 with no-store when authenticated', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });

    const response = await inquiryRecordPatch(
      createRequest('http://localhost/api/inquiry-records/inquiry_1', { 'x-org-id': 'org_1' }, {}),
      { params: Promise.resolve({ id: 'inquiry_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
  });

  it('first-visit-documents/[id] PATCH returns 401 with no-store when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const response = await firstVisitDocumentPatch(
      createRequest(
        'http://localhost/api/first-visit-documents/doc_1',
        { 'x-org-id': 'org_1' },
        { delivered_to: '山田太郎' },
      ),
      { params: Promise.resolve({ id: 'doc_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(401);
    expectNoStore(response);
  });

  it('first-visit-documents/[id] PATCH returns 403 with no-store when role lacks permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'driver' });

    const response = await firstVisitDocumentPatch(
      createRequest(
        'http://localhost/api/first-visit-documents/doc_1',
        { 'x-org-id': 'org_1' },
        { delivered_to: '山田太郎' },
      ),
      { params: Promise.resolve({ id: 'doc_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectNoStore(response);
  });

  it('first-visit-documents/[id] PATCH returns 200 with no-store when authenticated', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });

    const response = await firstVisitDocumentPatch(
      createRequest(
        'http://localhost/api/first-visit-documents/doc_1',
        { 'x-org-id': 'org_1' },
        { delivered_to: '山田太郎' },
      ),
      { params: Promise.resolve({ id: 'doc_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
  });

  it('notifications PATCH returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const response = await notificationsPatch(
      createRequest('http://localhost/api/notifications', { 'x-org-id': 'org_1' }, { all: true }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(401);
    expectNoStore(response);
  });

  it('notifications PATCH returns 200 when authenticated', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });

    const response = await notificationsPatch(
      createRequest('http://localhost/api/notifications', { 'x-org-id': 'org_1' }, { all: true }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
  });
});
