import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';

const {
  authMock,
  membershipFindFirstMock,
  visitScheduleProposalFindFirstMock,
  visitScheduleProposalTxFindFirstMock,
  visitScheduleProposalFindManyMock,
  visitScheduleProposalRouteFindManyMock,
  visitScheduleProposalBatchFindUniqueMock,
  visitScheduleProposalBatchCreateMock,
  userFindManyMock,
  userFindFirstMock,
  careCaseFindFirstMock,
  patientInsuranceFindFirstMock,
  billingCandidateFindManyMock,
  visitScheduleFindManyMock,
  visitScheduleFindFirstMock,
  visitScheduleCountMock,
  prescriptionIntakeFindFirstMock,
  visitVehicleResourceFindFirstMock,
  validateOrgReferencesMock,
  generateVisitScheduleProposalDraftsMock,
  visitScheduleProposalUpdateManyMock,
  visitScheduleProposalCreateMock,
  auditLogCreateMock,
  taskUpdateManyMock,
  withOrgContextMock,
  findActiveVisitConsentMock,
  findCurrentManagementPlanMock,
  notifyWorkflowMutationMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  visitScheduleProposalFindFirstMock: vi.fn(),
  visitScheduleProposalTxFindFirstMock: vi.fn(),
  visitScheduleProposalFindManyMock: vi.fn(),
  visitScheduleProposalRouteFindManyMock: vi.fn(),
  visitScheduleProposalBatchFindUniqueMock: vi.fn(),
  visitScheduleProposalBatchCreateMock: vi.fn(),
  userFindManyMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  patientInsuranceFindFirstMock: vi.fn(),
  billingCandidateFindManyMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
  visitScheduleCountMock: vi.fn(),
  prescriptionIntakeFindFirstMock: vi.fn(),
  visitVehicleResourceFindFirstMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  generateVisitScheduleProposalDraftsMock: vi.fn(),
  visitScheduleProposalUpdateManyMock: vi.fn(),
  visitScheduleProposalCreateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  taskUpdateManyMock: vi.fn(),
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
      findFirst: visitScheduleProposalFindFirstMock,
      findMany: visitScheduleProposalFindManyMock,
    },
    visitScheduleProposalBatch: {
      findUnique: visitScheduleProposalBatchFindUniqueMock,
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
      findMany: visitScheduleFindManyMock,
      findFirst: visitScheduleFindFirstMock,
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

import { GET as rawGET, POST as rawPOST, PUT as rawPUT } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);
const PUT = (req: NextRequest) => rawPUT(req, emptyRouteContext);

function createRequest(url: string, body?: unknown) {
  if (body === undefined) {
    return new NextRequest(url, {
      headers: { 'x-org-id': 'org_1' },
    });
  }
  const requestBody =
    body && typeof body === 'object' && !Array.isArray(body) && !('idempotency_key' in body)
      ? { idempotency_key: 'proposal-test-key', ...body }
      : body;
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(requestBody),
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
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

function buildSerializableConflictError() {
  return new Prisma.PrismaClientKnownRequestError('Serializable transaction conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

function buildProposalBatchIdempotencyRaceError() {
  return new Prisma.PrismaClientKnownRequestError('Unique idempotency key race', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: ['org_id', 'idempotency_key'] },
  });
}

async function withTimezone<T>(timezone: string, run: () => Promise<T>): Promise<T> {
  const originalTimezone = process.env.TZ;
  process.env.TZ = timezone;
  try {
    return await run();
  } finally {
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  }
}

function buildExpectedProposalRequestFingerprint(overrides?: Record<string, unknown>) {
  const material = JSON.stringify({
    case_id: 'case_1',
    visit_type: 'regular',
    priority: 'normal',
    start_date: null,
    locked_date: null,
    candidate_count: 1,
    travel_mode: 'DRIVE',
    preferred_time_from: null,
    preferred_time_to: null,
    preferred_pharmacist_id: null,
    vehicle_resource_id: null,
    reschedule_source_schedule_id: null,
    reproposal_source_proposal_id: null,
    special_cap_eligible: null,
    operating_day_override_reason: null,
    ...overrides,
  });
  return `visit-proposal:v1:${createHash('sha256').update(material).digest('hex')}`;
}

function buildExpectedLegacyProposalRequestFingerprint(overrides?: Record<string, unknown>) {
  const material = JSON.stringify({
    case_id: 'case_1',
    visit_type: 'regular',
    priority: 'normal',
    start_date: null,
    locked_date: null,
    candidate_count: 1,
    travel_mode: 'DRIVE',
    preferred_time_from: null,
    preferred_time_to: null,
    preferred_pharmacist_id: null,
    vehicle_resource_id: null,
    reschedule_source_schedule_id: null,
    reproposal_source_proposal_id: null,
    special_cap_eligible: null,
    ...overrides,
  });
  return `visit-proposal:v1:${createHash('sha256').update(material).digest('hex')}`;
}

function createPutRequest(body: unknown) {
  return new NextRequest('http://localhost/api/visit-schedule-proposals', {
    method: 'PUT',
    body: JSON.stringify(body),
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
                lat: 35.1,
                lng: 139.1,
                geocode_source: 'internal-geocoder',
              },
            ],
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
        contact_logs: [
          {
            id: 'contact_log_1',
            outcome: 'attempted',
            contact_method: 'phone',
            contact_name: '家族A',
            contact_phone: '090-0000-0000',
            note: '折返し待ち',
            callback_due_at: null,
            called_at: new Date('2026-03-26T10:00:00.000Z'),
            called_by: 'user_internal_1',
            idempotency_key: 'contact-key-1',
            request_fingerprint: 'contact-fingerprint-1',
          },
        ],
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
    visitScheduleFindManyMock.mockResolvedValue([]);
    visitScheduleFindFirstMock.mockResolvedValue(null);
    visitScheduleProposalRouteFindManyMock.mockResolvedValue([]);
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
          route_order: 1,
        },
      ],
      diagnostics: {
        accepted: [],
        rejected: [],
      },
    });
    visitScheduleProposalCreateMock.mockResolvedValue({ id: 'proposal_2' });
    visitScheduleProposalBatchFindUniqueMock.mockResolvedValue(null);
    visitScheduleProposalBatchCreateMock.mockResolvedValue({ id: 'proposal_batch_1' });
    visitScheduleProposalFindFirstMock.mockResolvedValue(null);
    visitScheduleProposalTxFindFirstMock.mockResolvedValue({
      id: 'proposal_1',
      proposal_status: 'patient_contact_pending',
      patient_contact_status: 'pending',
    });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitScheduleProposal: {
          findFirst: visitScheduleProposalTxFindFirstMock,
          findMany: visitScheduleProposalRouteFindManyMock,
          updateMany: visitScheduleProposalUpdateManyMock,
          create: visitScheduleProposalCreateMock,
        },
        visitScheduleProposalBatch: {
          findUnique: visitScheduleProposalBatchFindUniqueMock,
          create: visitScheduleProposalBatchCreateMock,
        },
        visitSchedule: {
          findFirst: visitScheduleFindFirstMock,
          findMany: visitScheduleFindManyMock,
          count: visitScheduleCountMock,
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
        user: {
          findFirst: userFindFirstMock,
        },
        consentRecord: {
          findFirst: findActiveVisitConsentMock,
        },
        managementPlan: {
          findFirst: findCurrentManagementPlanMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
        task: {
          updateMany: taskUpdateManyMock,
        },
      }),
    );
  });

  it('lists proposals with pharmacist metadata', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/visit-schedule-proposals?case_id=case_1'),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
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
          contact_logs: [
            {
              id: 'contact_log_1',
              outcome: 'attempted',
              contact_method: 'phone',
              callback_due_at: null,
              called_at: '2026-03-26T10:00:00.000Z',
              has_note: true,
            },
          ],
        }),
      ],
    });
    expect(body.data[0]).not.toHaveProperty('reject_reason');
    expect(body.data[0].case_).not.toHaveProperty('patient_id');
    expect(body.data[0].case_.patient).toEqual({
      id: 'patient_1',
      name: '患者A',
      residences: [
        {
          address: '東京都千代田区1-1-1',
          building_id: '建物A',
          unit_name: '203号室',
          lat: 35.1,
          lng: 139.1,
        },
      ],
    });
    expect(body.data[0].case_.patient).not.toHaveProperty('phone');
    expect(body.data[0].case_.patient).not.toHaveProperty('medical_insurance_number');
    expect(body.data[0].case_.patient).not.toHaveProperty('care_insurance_number');
    expect(body.data[0].case_.patient).not.toHaveProperty('allergy_info');
    expect(body.data[0].case_.patient).not.toHaveProperty('notes');
    expect(body.data[0].case_.patient.residences[0]).not.toHaveProperty('geocode_source');
    expect(body.data[0].contact_logs[0]).not.toHaveProperty('contact_name');
    expect(body.data[0].contact_logs[0]).not.toHaveProperty('contact_phone');
    expect(body.data[0].contact_logs[0]).not.toHaveProperty('note');
    expect(body.data[0].contact_logs[0]).not.toHaveProperty('called_by');
    expect(body.data[0].contact_logs[0]).not.toHaveProperty('idempotency_key');
    expect(body.data[0].contact_logs[0]).not.toHaveProperty('request_fingerprint');
    expect(JSON.stringify(body)).not.toContain('家族A');
    expect(JSON.stringify(body)).not.toContain('090-0000-0000');
    expect(JSON.stringify(body)).not.toContain('折返し待ち');
    expect(JSON.stringify(body)).not.toContain('contact-key-1');
    expect(JSON.stringify(body)).not.toContain('contact-fingerprint-1');
    expect(JSON.stringify(body)).not.toContain('03-0000-0000');
    expect(JSON.stringify(body)).not.toContain('MED-SECRET-1');
    expect(JSON.stringify(body)).not.toContain('CARE-SECRET-1');
    expect(JSON.stringify(body)).not.toContain('アレルギー詳細');
    expect(JSON.stringify(body)).not.toContain('患者メモ詳細');
    expect(JSON.stringify(body)).not.toContain('internal-geocoder');
    expect(JSON.stringify(body)).not.toContain('東京都港区2-2-2');
    expect(JSON.stringify(body)).not.toContain('090-1234-5678');
    expect(JSON.stringify(body)).not.toContain('アムロジピン');
    expect(JSON.stringify(body)).not.toContain('処方詳細');
    expect(visitScheduleProposalFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          case_id: 'case_1',
        }),
      }),
    );
    // 組織横断アクセスロール(pharmacist)は担当割当スコープが撤廃され、
    // 提案クエリに AND/OR 担当割当句が付与されないことを確認する。
    const [listCall] = visitScheduleProposalFindManyMock.mock.calls;
    expect(listCall?.[0]?.where).not.toHaveProperty('AND');
  });

  it('returns a sanitized no-store 500 when proposal list auth lookup fails unexpectedly', async () => {
    authMock.mockRejectedValueOnce(
      new Error('患者 山田花子 090-1234-5678 raw proposal list auth detail'),
    );

    const response = (await GET(
      createRequest('http://localhost/api/visit-schedule-proposals?case_id=case_1'),
    ))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田花子');
    expect(JSON.stringify(body)).not.toContain('090-1234-5678');
    expect(JSON.stringify(body)).not.toContain('raw proposal list auth detail');
    expect(visitScheduleProposalFindManyMock).not.toHaveBeenCalled();
    expect(userFindManyMock).not.toHaveBeenCalled();
  });

  it('filters proposals by patient_id when provided', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/visit-schedule-proposals?patient_id=patient_1'),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
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

  it('filters proposals for global search without changing the unbounded list default', async () => {
    const response = (await GET(
      createRequest(
        'http://localhost/api/visit-schedule-proposals?q=田中&status=patient_contact_pending&pharmacist_id=user_2&limit=8',
      ),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(visitScheduleProposalFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          case_: {
            is: {
              patient: {
                is: {
                  name: {
                    contains: '田中',
                    mode: 'insensitive',
                  },
                },
              },
            },
          },
          proposal_status: 'patient_contact_pending',
          proposed_pharmacist_id: 'user_2',
        }),
        take: 8,
      }),
    );
  });

  it('returns a bounded minimal projection for palette proposal search', async () => {
    visitScheduleProposalFindManyMock.mockResolvedValueOnce([
      {
        id: 'proposal_palette_1',
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'pending',
        proposed_date: new Date('2026-04-03T00:00:00.000Z'),
        time_window_start: new Date('2026-04-03T09:00:00.000Z'),
        time_window_end: new Date('2026-04-03T10:00:00.000Z'),
        proposed_pharmacist_id: 'user_2',
        reject_reason: '東京都港区2-2-2 090-1234-5678 アムロジピン 処方詳細',
        site: { id: 'site_1', name: '訪問拠点A', address: '東京都渋谷区' },
        vehicle_resource: { id: 'vehicle_1', label: '社用車A' },
        contact_logs: [{ note: '家族へ折返し待ち', contact_phone: '090-0000-0000' }],
        case_: {
          patient: {
            id: 'patient_1',
            name: '患者A',
            phone: '03-0000-0000',
            residences: [{ address: '東京都千代田区1-1-1', lat: 35.1, lng: 139.1 }],
          },
        },
      },
      {
        id: 'proposal_palette_2',
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'pending',
        proposed_date: new Date('2026-04-04T00:00:00.000Z'),
        time_window_start: new Date('2026-04-04T09:00:00.000Z'),
        time_window_end: new Date('2026-04-04T10:00:00.000Z'),
        proposed_pharmacist_id: null,
        case_: {
          patient: {
            id: 'patient_2',
            name: '患者B',
          },
        },
      },
    ]);

    const response = (await GET(
      createRequest('http://localhost/api/visit-schedule-proposals?view=palette&q=患者&limit=1'),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toEqual({
      data: [
        {
          id: 'proposal_palette_1',
          proposal_status: 'patient_contact_pending',
          patient_contact_status: 'pending',
          proposed_date: '2026-04-03T00:00:00.000Z',
          time_window_start: '2026-04-03T09:00:00.000Z',
          time_window_end: '2026-04-03T10:00:00.000Z',
          case_: {
            patient: {
              id: 'patient_1',
              name: '患者A',
            },
          },
          proposed_pharmacist: {
            name: '薬剤師A',
          },
        },
      ],
      hasMore: true,
    });
    const listCall = visitScheduleProposalFindManyMock.mock.calls[0]?.[0];
    expect(listCall).toMatchObject({
      take: 2,
      select: {
        id: true,
        proposal_status: true,
        patient_contact_status: true,
        proposed_date: true,
        time_window_start: true,
        time_window_end: true,
        proposed_pharmacist_id: true,
        case_: {
          select: {
            patient: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });
    expect(listCall).not.toHaveProperty('include');
    expect(JSON.stringify(body)).not.toContain('東京都港区');
    expect(JSON.stringify(body)).not.toContain('090-1234-5678');
    expect(JSON.stringify(body)).not.toContain('アムロジピン');
    expect(JSON.stringify(body)).not.toContain('訪問拠点A');
    expect(JSON.stringify(body)).not.toContain('社用車A');
    expect(JSON.stringify(body)).not.toContain('家族へ折返し待ち');
    expect(JSON.stringify(body)).not.toContain('03-0000-0000');
    expect(JSON.stringify(body)).not.toContain('東京都千代田区');
    expect(body.data[0]).not.toHaveProperty('reject_reason');
    expect(body.data[0]).not.toHaveProperty('site');
    expect(body.data[0]).not.toHaveProperty('vehicle_resource');
    expect(body.data[0]).not.toHaveProperty('contact_logs');
    expect(body.data[0].proposed_pharmacist).not.toHaveProperty('id');
    expect(body.data[0].case_.patient).not.toHaveProperty('residences');
    expect(body.data[0].case_.patient).not.toHaveProperty('phone');
  });

  it('rejects unsupported status filters before querying proposals', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/visit-schedule-proposals?status=unknown'),
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'status が不正です',
    });
    expect(visitScheduleProposalFindManyMock).not.toHaveBeenCalled();
    expect(userFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects invalid proposal search limits before querying proposals', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/visit-schedule-proposals?limit=200'),
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'limit は 1〜50 の整数で指定してください',
    });
    expect(visitScheduleProposalFindManyMock).not.toHaveBeenCalled();
    expect(userFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects invalid proposal date filters before querying proposals', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/visit-schedule-proposals?date_from=2026-02-30'),
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'date_from の日付形式が不正です（YYYY-MM-DD）',
    });
    expect(visitScheduleProposalFindManyMock).not.toHaveBeenCalled();
    expect(userFindManyMock).not.toHaveBeenCalled();
  });

  it.each([
    ['case_id=', 'case_id', 'case_id が不正です'],
    ['case_id=%20case_1%20', 'case_id', 'case_id が不正です'],
    ['patient_id=', 'patient_id', 'patient_id が不正です'],
    ['patient_id=%20patient_1', 'patient_id', 'patient_id が不正です'],
    ['pharmacist_id=', 'pharmacist_id', 'pharmacist_id が不正です'],
    ['pharmacist_id=user_2%20', 'pharmacist_id', 'pharmacist_id が不正です'],
    ['status=%20patient_contact_pending', 'status', 'status が不正です'],
    ['date_from=', 'date_from', 'date_from の日付形式が不正です（YYYY-MM-DD）'],
    ['date_to=%202026-04-03', 'date_to', 'date_to の日付形式が不正です（YYYY-MM-DD）'],
    ['q=', 'q', 'q が不正です'],
    ['q=%20%20', 'q', 'q が不正です'],
    ['q=%20田中%20', 'q', 'q が不正です'],
    ['limit=', 'limit', 'limit が不正です'],
    ['view=%20palette', 'view', 'view が不正です'],
  ])(
    'rejects blank or malformed proposal filter query "%s" before querying proposals',
    async (query, fieldName, message) => {
      const response = (await GET(
        createRequest(`http://localhost/api/visit-schedule-proposals?${query}`),
      ))!;

      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '検索条件が不正です',
        details: {
          [fieldName]: [message],
        },
      });
      expect(visitScheduleProposalFindManyMock).not.toHaveBeenCalled();
      expect(userFindManyMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['case_id=case_1&case_id=case_2', 'case_id'],
    ['patient_id=patient_1&patient_id=patient_2', 'patient_id'],
    ['status=patient_contact_pending&status=proposed', 'status'],
    ['pharmacist_id=user_1&pharmacist_id=user_2', 'pharmacist_id'],
    ['date_from=2026-04-01&date_from=2026-04-02', 'date_from'],
    ['date_to=2026-04-03&date_to=2026-04-04', 'date_to'],
    ['q=田中&q=佐藤', 'q'],
    ['limit=8&limit=9', 'limit'],
    ['view=palette&view=palette', 'view'],
  ])(
    'rejects duplicate proposal filter query "%s" before querying proposals',
    async (query, fieldName) => {
      const response = (await GET(
        createRequest(`http://localhost/api/visit-schedule-proposals?${query}`),
      ))!;

      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '検索条件が不正です',
        details: {
          [fieldName]: [`${fieldName} は1つだけ指定してください`],
        },
      });
      expect(visitScheduleProposalFindManyMock).not.toHaveBeenCalled();
      expect(userFindManyMock).not.toHaveBeenCalled();
    },
  );

  it('creates proposal drafts and supersedes open proposals', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
      }),
    ))!;

    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      case_id: 'case_1',
    });
    expect(careCaseFindFirstMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'case_1',
          org_id: 'org_1',
        }),
        select: { id: true, patient_id: true },
      }),
    );
    // 組織横断アクセスロール(pharmacist)はケースアクセススコープが撤廃され、
    // 担当割当の AND 句が付与されないことを確認する。
    expect(careCaseFindFirstMock.mock.calls[0]?.[0]?.where).not.toHaveProperty('AND');
    expect(generateVisitScheduleProposalDraftsMock).toHaveBeenCalled();
    expect(visitScheduleProposalUpdateManyMock).toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reproposal_source_proposal_id: null,
      }),
    });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('carries source schedule lineage and resolves reproposal tasks for change-requested reproposals', async () => {
    visitScheduleProposalFindFirstMock.mockResolvedValueOnce({
      id: 'proposal_source',
      case_id: 'case_1',
      proposal_status: 'reschedule_pending',
      patient_contact_status: 'change_requested',
      reschedule_source_schedule_id: 'schedule_source',
    });
    visitScheduleProposalCreateMock.mockImplementationOnce(({ data }) =>
      Promise.resolve({ id: 'proposal_reproposal', ...data }),
    );

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
        reproposal_source_proposal_id: 'proposal_source',
        idempotency_key: 'proposal-reproposal-key-1',
      }),
    ))!;

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          reproposal_source_proposal_id: 'proposal_source',
        }),
      ],
    });
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      case_id: 'case_1',
      schedule_id: 'schedule_source',
    });
    expect(generateVisitScheduleProposalDraftsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        rescheduleSourceScheduleId: 'schedule_source',
      }),
    );
    expect(visitScheduleProposalBatchCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        request_fingerprint: buildExpectedProposalRequestFingerprint({
          reschedule_source_schedule_id: 'schedule_source',
          reproposal_source_proposal_id: 'proposal_source',
        }),
      }),
    });
    expect(visitScheduleProposalCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reschedule_source_schedule_id: 'schedule_source',
        reproposal_source_proposal_id: 'proposal_source',
      }),
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          changes: expect.objectContaining({
            proposal_batch_id: 'proposal_batch_1',
            reschedule_source_schedule_id: 'schedule_source',
            reproposal_source_proposal_id: 'proposal_source',
          }),
        }),
      }),
    );
    expect(visitScheduleProposalUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        org_id: 'org_1',
        case_id: 'case_1',
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
        reschedule_source_schedule_id: 'schedule_source',
      }),
      data: {
        proposal_status: 'superseded',
      },
    });
    expect(taskUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        status: { in: ['pending', 'in_progress'] },
        dedupe_key: 'visit-reproposal-needed:proposal_source',
      },
      data: {
        status: 'completed',
        completed_at: expect.any(Date),
      },
    });
  });

  it('rejects proposal generation without idempotency_key before planner or write side effects', async () => {
    const response = (await POST(
      new NextRequest('http://localhost/api/visit-schedule-proposals', {
        method: 'POST',
        body: JSON.stringify({
          case_id: 'case_1',
          visit_type: 'regular',
          candidate_count: 1,
        }),
        headers: {
          'content-type': 'application/json',
          'x-org-id': 'org_1',
        },
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        idempotency_key: ['Invalid input: expected string, received undefined'],
      },
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(generateVisitScheduleProposalDraftsMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('creates an idempotency batch and links generated proposals when idempotency_key is provided', async () => {
    visitScheduleProposalCreateMock.mockImplementationOnce(({ data }) =>
      Promise.resolve({ id: 'proposal_2', ...data }),
    );

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
        idempotency_key: 'proposal-key-1',
      }),
    ))!;

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ replayed: false });
    expect(visitScheduleProposalBatchFindUniqueMock).toHaveBeenCalledWith({
      where: {
        org_id_idempotency_key: {
          org_id: 'org_1',
          idempotency_key: 'proposal-key-1',
        },
      },
      include: {
        proposals: {
          orderBy: { created_at: 'asc' },
        },
      },
    });
    expect(visitScheduleProposalBatchCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        case_id: 'case_1',
        idempotency_key: 'proposal-key-1',
        request_fingerprint: expect.stringMatching(/^visit-proposal:v1:[a-f0-9]{64}$/),
        created_by: 'user_1',
      }),
    });
    expect(visitScheduleProposalCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        proposal_batch_id: 'proposal_batch_1',
      }),
    });
    expect(notifyWorkflowMutationMock).toHaveBeenCalled();
  });

  it('replays an existing idempotent proposal batch without superseding or creating proposals', async () => {
    visitScheduleProposalBatchFindUniqueMock.mockResolvedValueOnce({
      id: 'proposal_batch_1',
      org_id: 'org_1',
      case_id: 'case_1',
      idempotency_key: 'proposal-key-1',
      request_fingerprint: buildExpectedProposalRequestFingerprint(),
      proposals: [
        {
          id: 'proposal_existing',
          org_id: 'org_1',
          case_id: 'case_1',
          created_at: new Date('2026-04-01T00:00:00.000Z'),
        },
      ],
    });
    const replay = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
        idempotency_key: 'proposal-key-1',
      }),
    ))!;

    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      replayed: true,
      data: [expect.objectContaining({ id: 'proposal_existing' })],
    });
    expect(visitScheduleProposalUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('replays legacy idempotent proposal batches when no operating-day override reason is supplied', async () => {
    visitScheduleProposalBatchFindUniqueMock.mockResolvedValueOnce({
      id: 'proposal_batch_legacy',
      org_id: 'org_1',
      case_id: 'case_1',
      idempotency_key: 'proposal-legacy-key-1',
      request_fingerprint: buildExpectedLegacyProposalRequestFingerprint(),
      proposals: [
        {
          id: 'proposal_existing_legacy',
          org_id: 'org_1',
          case_id: 'case_1',
          created_at: new Date('2026-04-01T00:00:00.000Z'),
        },
      ],
    });

    const replay = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
        idempotency_key: 'proposal-legacy-key-1',
      }),
    ))!;

    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      replayed: true,
      data: [expect.objectContaining({ id: 'proposal_existing_legacy' })],
    });
    expect(generateVisitScheduleProposalDraftsMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects legacy idempotency fingerprints when a new operating-day override reason is supplied', async () => {
    visitScheduleProposalBatchFindUniqueMock.mockResolvedValueOnce({
      id: 'proposal_batch_legacy',
      org_id: 'org_1',
      case_id: 'case_1',
      idempotency_key: 'proposal-legacy-key-1',
      request_fingerprint: buildExpectedLegacyProposalRequestFingerprint(),
      proposals: [],
    });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
        operating_day_override_reason: '患者都合により定休日対応',
        idempotency_key: 'proposal-legacy-key-1',
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'idempotency_key が別の訪問候補生成リクエストで使用されています',
    });
    expect(generateVisitScheduleProposalDraftsMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects an idempotency key reused with a different proposal request', async () => {
    visitScheduleProposalBatchFindUniqueMock.mockResolvedValueOnce({
      id: 'proposal_batch_1',
      org_id: 'org_1',
      case_id: 'case_1',
      idempotency_key: 'proposal-key-1',
      request_fingerprint: 'visit-proposal:v1:different',
      proposals: [],
    });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
        idempotency_key: 'proposal-key-1',
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'idempotency_key が別の訪問候補生成リクエストで使用されています',
    });
    expect(visitScheduleProposalUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects an idempotency key reused between default and special-cap proposal requests', async () => {
    visitScheduleProposalBatchFindUniqueMock.mockResolvedValueOnce({
      id: 'proposal_batch_1',
      org_id: 'org_1',
      case_id: 'case_1',
      idempotency_key: 'proposal-special-key-1',
      request_fingerprint: buildExpectedProposalRequestFingerprint(),
      proposals: [],
    });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
        special_cap_eligible: true,
        idempotency_key: 'proposal-special-key-1',
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'idempotency_key が別の訪問候補生成リクエストで使用されています',
    });
    expect(generateVisitScheduleProposalDraftsMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalBatchCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('replays a raced idempotency batch after the create transaction aborts on P2002', async () => {
    visitScheduleProposalBatchFindUniqueMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'proposal_batch_1',
        org_id: 'org_1',
        case_id: 'case_1',
        idempotency_key: 'proposal-key-1',
        request_fingerprint: buildExpectedProposalRequestFingerprint(),
        proposals: [
          {
            id: 'proposal_existing_after_race',
            org_id: 'org_1',
            case_id: 'case_1',
            created_at: new Date('2026-04-01T00:00:00.000Z'),
          },
        ],
      });
    visitScheduleProposalBatchCreateMock.mockRejectedValueOnce(
      buildProposalBatchIdempotencyRaceError(),
    );

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
        idempotency_key: 'proposal-key-1',
      }),
    ))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      replayed: true,
      data: [expect.objectContaining({ id: 'proposal_existing_after_race' })],
    });
    expect(visitScheduleProposalBatchFindUniqueMock).toHaveBeenCalledTimes(3);
    expect(visitScheduleProposalUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('reallocates created proposal route orders after active schedules and remaining open proposals', async () => {
    visitScheduleFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        scheduled_date: new Date('2026-04-03T00:00:00.000Z'),
        pharmacist_id: 'user_2',
        route_order: 2,
      },
    ]);
    visitScheduleProposalRouteFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          proposed_date: new Date('2026-04-03T00:00:00.000Z'),
          proposed_pharmacist_id: 'user_2',
          route_order: 4,
        },
      ]);
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
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        schedule_status: { notIn: ['cancelled', 'rescheduled'] },
        route_order: { not: null },
        OR: [
          {
            pharmacist_id: 'user_2',
            scheduled_date: new Date('2026-04-03T00:00:00.000Z'),
          },
        ],
      },
      select: {
        scheduled_date: true,
        pharmacist_id: true,
        route_order: true,
      },
    });
    expect(visitScheduleProposalRouteFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        finalized_schedule_id: null,
        proposal_status: { in: ['proposed', 'patient_contact_pending', 'reschedule_pending'] },
        route_order: { not: null },
        OR: [
          {
            proposed_pharmacist_id: 'user_2',
            proposed_date: new Date('2026-04-03T00:00:00.000Z'),
          },
        ],
      },
      select: {
        proposed_date: true,
        proposed_pharmacist_id: true,
        route_order: true,
        reschedule_source_schedule_id: true,
      },
    });
    expect(visitScheduleProposalCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        route_order: 5,
      }),
    });
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

  it('passes operating day override reasons to the planner and idempotency fingerprint', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
        operating_day_override_reason: '患者都合により定休日対応',
        idempotency_key: 'proposal-operating-override-key',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(generateVisitScheduleProposalDraftsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operatingDayOverrideReason: '患者都合により定休日対応',
      }),
    );
    expect(visitScheduleProposalBatchCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idempotency_key: 'proposal-operating-override-key',
        request_fingerprint: buildExpectedProposalRequestFingerprint({
          operating_day_override_reason: '患者都合により定休日対応',
        }),
      }),
    });
  });

  it('retries serializable proposal creation conflicts and reallocates on retry-time state', async () => {
    withOrgContextMock
      .mockRejectedValueOnce(buildSerializableConflictError())
      .mockImplementationOnce(async (_orgId, callback) =>
        callback({
          visitScheduleProposal: {
            findMany: visitScheduleProposalRouteFindManyMock,
            updateMany: visitScheduleProposalUpdateManyMock,
            create: visitScheduleProposalCreateMock,
          },
          visitScheduleProposalBatch: {
            findUnique: visitScheduleProposalBatchFindUniqueMock,
            create: visitScheduleProposalBatchCreateMock,
          },
          visitSchedule: {
            findFirst: visitScheduleFindFirstMock,
            findMany: visitScheduleFindManyMock,
            count: visitScheduleCountMock,
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
          user: {
            findFirst: userFindFirstMock,
          },
          consentRecord: {
            findFirst: findActiveVisitConsentMock,
          },
          managementPlan: {
            findFirst: findCurrentManagementPlanMock,
          },
          auditLog: {
            create: auditLogCreateMock,
          },
        }),
      );
    visitScheduleProposalRouteFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          proposed_date: new Date('2026-04-03T00:00:00.000Z'),
          proposed_pharmacist_id: 'user_2',
          route_order: 7,
          reschedule_source_schedule_id: null,
        },
      ]);
    visitScheduleProposalCreateMock.mockImplementationOnce(({ data }) =>
      Promise.resolve({ id: 'proposal_retry', ...data }),
    );

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(withOrgContextMock).toHaveBeenCalledTimes(2);
    expect(withOrgContextMock).toHaveBeenNthCalledWith(1, 'org_1', expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(withOrgContextMock).toHaveBeenNthCalledWith(2, 'org_1', expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(visitScheduleProposalUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        case_id: 'case_1',
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
        reschedule_source_schedule_id: null,
      },
      data: {
        proposal_status: 'superseded',
      },
    });
    expect(visitScheduleProposalCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        route_order: 8,
      }),
    });
    expect(notifyWorkflowMutationMock).toHaveBeenCalledTimes(1);
  });

  it('returns conflict when serializable proposal creation conflicts exceed the retry limit', async () => {
    withOrgContextMock.mockRejectedValue(buildSerializableConflictError());

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '訪問候補の生成が同時に更新されました。再読み込みしてください',
    });
    expect(withOrgContextMock).toHaveBeenCalledTimes(3);
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when proposal generation fails unexpectedly', async () => {
    withOrgContextMock.mockRejectedValueOnce(
      new Error('患者 山田花子 090-1234-5678 raw proposal generation detail'),
    );

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
      }),
    ))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田花子');
    expect(JSON.stringify(body)).not.toContain('090-1234-5678');
    expect(JSON.stringify(body)).not.toContain('raw proposal generation detail');
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects generated proposals that collide with an active schedule before batch or supersede side effects', async () => {
    visitScheduleFindFirstMock.mockResolvedValueOnce({ id: 'schedule_existing' });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同一ケース・同一日付の訪問予定が既に存在します。既存予定を確認してください',
    });
    expect(visitScheduleFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        case_id: 'case_1',
        visit_type: 'regular',
        scheduled_date: {
          in: [new Date('2026-04-03T00:00:00.000Z')],
        },
        schedule_status: { notIn: ['cancelled', 'rescheduled'] },
      },
      select: { id: true },
    });
    expect(visitScheduleProposalBatchCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects generated proposals that collide with an open proposal outside the supersede scope before write side effects', async () => {
    visitScheduleProposalRouteFindManyMock.mockResolvedValueOnce([
      {
        id: 'proposal_other_scope',
        case_id: 'case_1',
        proposed_date: new Date('2026-04-03T00:00:00.000Z'),
        proposed_pharmacist_id: 'user_2',
        reschedule_source_schedule_id: 'schedule_other',
      },
    ]);

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message:
        '同一ケース・同一日付・同一担当薬剤師の未確定候補が既に存在します。既存候補を編集してください',
    });
    expect(visitScheduleProposalRouteFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        case_id: 'case_1',
        finalized_schedule_id: null,
        proposal_status: { in: ['proposed', 'patient_contact_pending', 'reschedule_pending'] },
        OR: [
          {
            proposed_pharmacist_id: 'user_2',
            proposed_date: new Date('2026-04-03T00:00:00.000Z'),
          },
        ],
      },
      select: {
        id: true,
        case_id: true,
        proposed_date: true,
        proposed_pharmacist_id: true,
        reschedule_source_schedule_id: true,
      },
    });
    expect(visitScheduleProposalBatchCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate generated proposal route cells before write side effects', async () => {
    generateVisitScheduleProposalDraftsMock.mockResolvedValueOnce({
      drafts: [
        {
          org_id: 'org_1',
          case_id: 'case_1',
          proposed_pharmacist_id: 'user_2',
          proposed_date: new Date('2026-04-03T00:00:00.000Z'),
          site_id: 'site_1',
          route_order: 1,
        },
        {
          org_id: 'org_1',
          case_id: 'case_1',
          proposed_pharmacist_id: 'user_2',
          proposed_date: new Date('2026-04-03T00:00:00.000Z'),
          site_id: 'site_1',
          route_order: 2,
        },
      ],
      diagnostics: {
        accepted: [],
        rejected: [],
      },
    });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 2,
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message:
        '同一ケース・同一日付・同一担当薬剤師の未確定候補が既に存在します。既存候補を編集してください',
    });
    expect(visitScheduleProposalBatchCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when draft proposal auth lookup fails unexpectedly', async () => {
    authMock.mockRejectedValueOnce(
      new Error('患者 山田花子 090-1234-5678 raw draft proposal auth detail'),
    );

    const response = (await PUT(
      createPutRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        priority: 'normal',
        proposed_date: '2026-04-03',
        time_window_start: '09:00',
        time_window_end: '10:00',
        proposed_pharmacist_id: 'user_2',
        travel_mode: 'DRIVE',
        submit_for_contact: false,
      }),
    ))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田花子');
    expect(JSON.stringify(body)).not.toContain('090-1234-5678');
    expect(JSON.stringify(body)).not.toContain('raw draft proposal auth detail');
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('retries draft drawer proposal conflicts and rejects a retry-time duplicate open proposal', async () => {
    withOrgContextMock
      .mockRejectedValueOnce(buildSerializableConflictError())
      .mockImplementationOnce(async (_orgId, callback) =>
        callback({
          visitScheduleProposal: {
            findFirst: visitScheduleProposalTxFindFirstMock,
            findMany: visitScheduleProposalRouteFindManyMock,
            updateMany: visitScheduleProposalUpdateManyMock,
            create: visitScheduleProposalCreateMock,
          },
          visitSchedule: {
            findFirst: visitScheduleFindFirstMock,
            findMany: visitScheduleFindManyMock,
            count: visitScheduleCountMock,
          },
        }),
      );
    visitScheduleProposalRouteFindManyMock.mockResolvedValueOnce([{ id: 'proposal_after_retry' }]);

    const response = (await PUT(
      createPutRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        priority: 'normal',
        proposed_date: '2026-04-03',
        time_window_start: '09:00',
        time_window_end: '10:00',
        proposed_pharmacist_id: 'user_2',
        travel_mode: 'DRIVE',
        submit_for_contact: false,
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message:
        '同一ケース・同一日付・同一担当薬剤師の未確定候補が既に存在します。既存候補を編集してください',
    });
    expect(withOrgContextMock).toHaveBeenCalledTimes(2);
    expect(visitScheduleProposalUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects draft drawer proposals that collide with an active schedule for the same case date and type', async () => {
    visitScheduleFindFirstMock.mockResolvedValueOnce({ id: 'schedule_existing' });

    const response = (await PUT(
      createPutRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        priority: 'normal',
        proposed_date: '2026-04-03',
        time_window_start: '09:00',
        time_window_end: '10:00',
        proposed_pharmacist_id: 'user_2',
        travel_mode: 'DRIVE',
        submit_for_contact: true,
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同一ケース・同一日付の訪問予定が既に存在します。既存予定を確認してください',
    });
    expect(visitScheduleFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        case_id: 'case_1',
        visit_type: 'regular',
        scheduled_date: new Date('2026-04-03T00:00:00.000Z'),
        schedule_status: { notIn: ['cancelled', 'rescheduled'] },
      },
      select: { id: true },
    });
    expect(visitScheduleProposalUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
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
    expect(visitScheduleProposalUpdateManyMock).not.toHaveBeenCalled();
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

  it('rejects blank reproposal source proposal ids before case lookup or planner side effects', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        candidate_count: 1,
        reproposal_source_proposal_id: '',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        reproposal_source_proposal_id: ['再提案元の訪問候補IDは必須です'],
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

  it.each(['attempted', 'unreachable', 'declined', 'change_requested', 'confirmed'] as const)(
    'rejects direct %s contact status from the draft drawer before write side effects',
    async (patientContactStatus) => {
      const response = (await PUT(
        createPutRequest({
          case_id: 'case_1',
          visit_type: 'regular',
          priority: 'normal',
          proposed_date: '2026-04-03',
          time_window_start: '09:00',
          time_window_end: '10:00',
          proposed_pharmacist_id: 'user_2',
          travel_mode: 'DRIVE',
          patient_contact_status: patientContactStatus,
          submit_for_contact: true,
        }),
      ))!;

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '入力値が不正です',
        details: {
          patient_contact_status: [
            '患者連絡状態は患者連絡ワークフローで連絡結果として記録してください',
          ],
        },
      });
      expect(careCaseFindFirstMock).not.toHaveBeenCalled();
      expect(validateOrgReferencesMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
      expect(auditLogCreateMock).not.toHaveBeenCalled();
      expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      payload: { time_window_start: '09:00' },
      details: { time_window_end: ['終了時刻も入力してください'] },
    },
    {
      payload: { time_window_end: '10:00' },
      details: { time_window_start: ['開始時刻も入力してください'] },
    },
  ])('rejects incomplete draft drawer time windows before write side effects', async (caseItem) => {
    const response = (await PUT(
      createPutRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        priority: 'normal',
        proposed_date: '2026-04-03',
        ...caseItem.payload,
        proposed_pharmacist_id: 'user_2',
        travel_mode: 'DRIVE',
        submit_for_contact: false,
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: caseItem.details,
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('requires a complete time window before moving a drawer proposal to patient contact', async () => {
    const response = (await PUT(
      createPutRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        priority: 'normal',
        proposed_date: '2026-04-03',
        proposed_pharmacist_id: 'user_2',
        travel_mode: 'DRIVE',
        submit_for_contact: true,
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        time_window_start: ['確認待ちにするには開始時刻と終了時刻を入力してください'],
      },
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('creates draft drawer proposals with UTC @db.Time sentinels', async () => {
    visitScheduleProposalCreateMock.mockImplementationOnce(({ data }) =>
      Promise.resolve({ id: 'proposal_manual', ...data }),
    );

    const response = (await PUT(
      createPutRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        priority: 'normal',
        proposed_date: '2026-04-03',
        time_window_start: '09:00',
        time_window_end: '10:00',
        proposed_pharmacist_id: 'user_2',
        travel_mode: 'DRIVE',
        submit_for_contact: false,
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(visitScheduleProposalCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        proposal_status: 'proposed',
        proposed_date: new Date('2026-04-03T00:00:00.000Z'),
        time_window_start: new Date(Date.UTC(1970, 0, 1, 9, 0)),
        time_window_end: new Date(Date.UTC(1970, 0, 1, 10, 0)),
      }),
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'visit_schedule_proposal_draft_created',
          changes: expect.objectContaining({
            proposalStatusTo: 'proposed',
            proposedDateTo: '2026-04-03',
            timeWindowStartTo: '09:00',
            timeWindowEndTo: '10:00',
            pharmacistIdTo: 'user_2',
            submittedForContact: false,
          }),
        }),
      }),
    );
  });

  it('rejects creating a duplicate open draft drawer proposal for the same case date and pharmacist', async () => {
    visitScheduleProposalRouteFindManyMock.mockResolvedValueOnce([{ id: 'proposal_existing' }]);

    const response = (await PUT(
      createPutRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        priority: 'normal',
        proposed_date: '2026-04-03',
        time_window_start: '09:00',
        time_window_end: '10:00',
        proposed_pharmacist_id: 'user_2',
        travel_mode: 'DRIVE',
        submit_for_contact: false,
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message:
        '同一ケース・同一日付・同一担当薬剤師の未確定候補が既に存在します。既存候補を編集してください',
    });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(visitScheduleProposalRouteFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        case_id: 'case_1',
        proposed_date: new Date('2026-04-03T00:00:00.000Z'),
        proposed_pharmacist_id: 'user_2',
        finalized_schedule_id: null,
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
      },
      select: { id: true },
      take: 1,
    });
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('records only changed fields when updating a draft drawer proposal', async () => {
    visitScheduleProposalFindFirstMock.mockResolvedValueOnce({
      id: 'proposal_1',
      proposal_status: 'proposed',
      patient_contact_status: 'pending',
      finalized_schedule_id: null,
      case_id: 'case_1',
      site_id: null,
      visit_type: 'regular',
      priority: 'normal',
      proposed_date: new Date('2026-04-03T00:00:00.000Z'),
      time_window_start: new Date(Date.UTC(1970, 0, 1, 9, 0)),
      time_window_end: new Date(Date.UTC(1970, 0, 1, 10, 0)),
      proposed_pharmacist_id: 'user_2',
      vehicle_resource_id: null,
    });
    visitScheduleProposalUpdateManyMock.mockResolvedValueOnce({ count: 1 });
    visitScheduleProposalTxFindFirstMock.mockResolvedValueOnce({
      id: 'proposal_1',
      proposal_status: 'patient_contact_pending',
      patient_contact_status: 'pending',
      finalized_schedule_id: null,
      case_id: 'case_1',
      site_id: null,
      visit_type: 'regular',
      priority: 'normal',
      proposed_date: new Date('2026-04-04T00:00:00.000Z'),
      time_window_start: new Date(Date.UTC(1970, 0, 1, 10, 0)),
      time_window_end: new Date(Date.UTC(1970, 0, 1, 11, 0)),
      proposed_pharmacist_id: 'user_2',
      vehicle_resource_id: null,
    });

    const response = (await PUT(
      createPutRequest({
        id: 'proposal_1',
        case_id: 'case_1',
        visit_type: 'regular',
        priority: 'normal',
        proposed_date: '2026-04-04',
        time_window_start: '10:00',
        time_window_end: '11:00',
        proposed_pharmacist_id: 'user_2',
        travel_mode: 'DRIVE',
        submit_for_contact: true,
      }),
    ))!;

    expect(response.status).toBe(200);
    const auditCall = auditLogCreateMock.mock.calls[0]?.[0];
    if (!auditCall) throw new Error('audit log call is required');
    expect(auditCall).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'visit_schedule_proposal_draft_updated',
          target_type: 'VisitScheduleProposal',
          target_id: 'proposal_1',
          changes: expect.objectContaining({
            proposalStatusFrom: 'proposed',
            proposalStatusTo: 'patient_contact_pending',
            proposedDateFrom: '2026-04-03',
            proposedDateTo: '2026-04-04',
            timeWindowStartFrom: '09:00',
            timeWindowStartTo: '10:00',
            timeWindowEndFrom: '10:00',
            timeWindowEndTo: '11:00',
            submittedForContact: true,
          }),
        }),
      }),
    );
    const auditChanges = auditCall.data.changes as Record<string, unknown>;
    expect(auditChanges).not.toHaveProperty('caseIdFrom');
    expect(auditChanges).not.toHaveProperty('caseIdTo');
    expect(auditChanges).not.toHaveProperty('pharmacistIdFrom');
    expect(auditChanges).not.toHaveProperty('pharmacistIdTo');
  });

  it('rejects moving an editable draft drawer proposal onto another open proposal cell', async () => {
    visitScheduleProposalFindFirstMock.mockResolvedValueOnce({
      id: 'proposal_1',
      proposal_status: 'proposed',
      patient_contact_status: 'pending',
      finalized_schedule_id: null,
      case_id: 'case_1',
      site_id: null,
      visit_type: 'regular',
      priority: 'normal',
      proposed_date: new Date('2026-04-03T00:00:00.000Z'),
      time_window_start: new Date(Date.UTC(1970, 0, 1, 9, 0)),
      time_window_end: new Date(Date.UTC(1970, 0, 1, 10, 0)),
      proposed_pharmacist_id: 'user_2',
      vehicle_resource_id: null,
    });
    visitScheduleProposalRouteFindManyMock.mockResolvedValueOnce([{ id: 'proposal_other' }]);

    const response = (await PUT(
      createPutRequest({
        id: 'proposal_1',
        case_id: 'case_1',
        visit_type: 'regular',
        priority: 'normal',
        proposed_date: '2026-04-04',
        time_window_start: '10:00',
        time_window_end: '11:00',
        proposed_pharmacist_id: 'user_2',
        travel_mode: 'DRIVE',
        submit_for_contact: true,
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message:
        '同一ケース・同一日付・同一担当薬剤師の未確定候補が既に存在します。既存候補を編集してください',
    });
    expect(visitScheduleProposalRouteFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { not: 'proposal_1' },
        case_id: 'case_1',
        proposed_date: new Date('2026-04-04T00:00:00.000Z'),
        proposed_pharmacist_id: 'user_2',
        finalized_schedule_id: null,
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
      },
      select: { id: true },
      take: 1,
    });
    expect(visitScheduleProposalUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects editing a proposal that has already been confirmed by patient contact', async () => {
    visitScheduleProposalFindFirstMock.mockResolvedValueOnce({
      id: 'proposal_1',
      proposal_status: 'patient_contact_pending',
      patient_contact_status: 'confirmed',
      finalized_schedule_id: null,
      proposed_pharmacist_id: 'user_2',
      proposed_date: new Date('2026-04-03T00:00:00.000Z'),
    });

    const response = (await PUT(
      createPutRequest({
        id: 'proposal_1',
        case_id: 'case_1',
        visit_type: 'regular',
        priority: 'normal',
        proposed_date: '2026-04-03',
        time_window_start: '09:00',
        time_window_end: '10:00',
        proposed_pharmacist_id: 'user_2',
        travel_mode: 'DRIVE',
        submit_for_contact: true,
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message:
        'この候補はすでに患者連絡が始まっています。候補詳細の患者連絡フローで更新してください',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns conflict when an editable proposal is finalized before the draft update claim', async () => {
    visitScheduleProposalFindFirstMock.mockResolvedValueOnce({
      id: 'proposal_1',
      proposal_status: 'patient_contact_pending',
      patient_contact_status: 'pending',
      finalized_schedule_id: null,
      proposed_pharmacist_id: 'user_2',
      proposed_date: new Date('2026-04-03T00:00:00.000Z'),
    });
    visitScheduleProposalUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = (await PUT(
      createPutRequest({
        id: 'proposal_1',
        case_id: 'case_1',
        visit_type: 'regular',
        priority: 'normal',
        proposed_date: '2026-04-03',
        time_window_start: '09:00',
        time_window_end: '10:00',
        proposed_pharmacist_id: 'user_2',
        travel_mode: 'DRIVE',
        submit_for_contact: true,
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'この候補はすでに確定または変更されています。再読み込みしてください',
    });
    expect(visitScheduleProposalUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'proposal_1',
        org_id: 'org_1',
        proposal_status: { in: ['proposed', 'patient_contact_pending'] },
        patient_contact_status: 'pending',
        finalized_schedule_id: null,
      },
      data: expect.objectContaining({
        proposal_status: 'patient_contact_pending',
        proposed_pharmacist_id: 'user_2',
      }),
    });
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
          route_order: 1,
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
          changes: expect.objectContaining({
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
          }),
        }),
      }),
    );
  });

  it('attaches accepted diagnostics to UTC-midnight proposal dates in negative-offset runtimes', async () => {
    await withTimezone('America/Los_Angeles', async () => {
      generateVisitScheduleProposalDraftsMock.mockResolvedValueOnce({
        drafts: [
          {
            org_id: 'org_1',
            case_id: 'case_1',
            proposed_pharmacist_id: 'user_2',
            proposed_date: new Date('2026-04-03T00:00:00.000Z'),
            site_id: 'site_1',
            route_order: 1,
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
          rejected: [],
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
      expect(auditLogCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            changes: expect.objectContaining({
              diagnostics: expect.objectContaining({
                accepted: [
                  expect.objectContaining({
                    pharmacist_id: 'user_2',
                    proposed_date: '2026-04-03',
                  }),
                ],
              }),
            }),
          }),
        }),
      );
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

  it('rejects proposal generation when transaction-time billing caps are exceeded before creating drafts', async () => {
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
    visitScheduleCountMock
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(4)
      .mockResolvedValue(0);
    visitScheduleFindManyMock.mockResolvedValue(
      ['2026-04-01', '2026-04-08', '2026-04-15', '2026-04-22'].map((date, index) => ({
        id: `schedule_${index}`,
        scheduled_date: new Date(`${date}T00:00:00.000Z`),
        pharmacist_id: 'user_2',
        visit_type: 'regular',
        case_: { patient_id: 'patient_1' },
      })),
    );

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
        start_date: '2026-04-01',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('月上限4回を超過します'),
    });
    expect(visitScheduleProposalBatchCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects proposal generation when accepted drafts cumulatively exceed monthly billing caps', async () => {
    generateVisitScheduleProposalDraftsMock.mockReset();
    visitScheduleCountMock.mockReset();
    visitScheduleFindManyMock.mockReset();
    visitScheduleProposalFindManyMock.mockReset();
    visitScheduleProposalRouteFindManyMock.mockReset();
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
    generateVisitScheduleProposalDraftsMock.mockResolvedValueOnce({
      drafts: [
        {
          org_id: 'org_1',
          case_id: 'case_1',
          proposed_pharmacist_id: 'user_2',
          proposed_date: new Date('2026-04-03T00:00:00.000Z'),
          site_id: 'site_1',
          route_order: 1,
        },
        {
          org_id: 'org_1',
          case_id: 'case_1',
          proposed_pharmacist_id: 'user_2',
          proposed_date: new Date('2026-04-10T00:00:00.000Z'),
          site_id: 'site_1',
          route_order: 2,
        },
      ],
      diagnostics: {
        accepted: [],
        rejected: [],
      },
    });
    visitScheduleCountMock.mockImplementation(async (args: unknown) => {
      const where = (args as { where?: Record<string, unknown> }).where;
      return where && 'case_' in where ? 3 : 0;
    });
    visitScheduleFindManyMock.mockResolvedValue(
      ['2026-04-01', '2026-04-08', '2026-04-15'].map((date, index) => ({
        id: `schedule_${index}`,
        scheduled_date: new Date(`${date}T00:00:00.000Z`),
        pharmacist_id: 'user_2',
        visit_type: 'regular',
        case_: { patient_id: 'patient_1' },
      })),
    );
    visitScheduleProposalFindManyMock.mockResolvedValue([]);
    visitScheduleProposalRouteFindManyMock.mockResolvedValue([]);

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 2,
        start_date: '2026-04-01',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('月上限4回を超過します'),
    });
    expect(visitScheduleProposalBatchCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('allows special-cap proposal generation at the default monthly cap boundary', async () => {
    generateVisitScheduleProposalDraftsMock.mockReset();
    visitScheduleCountMock.mockReset();
    visitScheduleFindManyMock.mockReset();
    visitScheduleProposalFindManyMock.mockReset();
    visitScheduleProposalRouteFindManyMock.mockReset();
    generateVisitScheduleProposalDraftsMock.mockResolvedValueOnce({
      drafts: [
        {
          org_id: 'org_1',
          case_id: 'case_1',
          proposed_pharmacist_id: 'user_2',
          proposed_date: new Date('2026-04-03T00:00:00.000Z'),
          site_id: 'site_1',
          route_order: 1,
        },
      ],
      diagnostics: {
        accepted: [],
        rejected: [],
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
    visitScheduleCountMock.mockImplementation(async (args: unknown) => {
      const where = (args as { where?: Record<string, unknown> }).where;
      return where && 'case_' in where ? 4 : 0;
    });
    visitScheduleFindManyMock
      .mockResolvedValueOnce(
        ['2026-04-01', '2026-04-08', '2026-04-15', '2026-04-22'].map((date, index) => ({
          id: `schedule_${index}`,
          scheduled_date: new Date(`${date}T00:00:00.000Z`),
          pharmacist_id: 'user_2',
          visit_type: 'regular',
          case_: { patient_id: 'patient_1' },
        })),
      )
      .mockResolvedValueOnce([]);
    visitScheduleProposalFindManyMock.mockResolvedValue([]);
    visitScheduleProposalRouteFindManyMock.mockResolvedValue([]);
    visitScheduleProposalCreateMock.mockImplementationOnce(({ data }) =>
      Promise.resolve({ id: 'proposal_special_cap', ...data }),
    );

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
        special_cap_eligible: true,
        start_date: '2026-04-01',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(visitScheduleProposalBatchCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idempotency_key: 'proposal-test-key',
        request_fingerprint: buildExpectedProposalRequestFingerprint({
          start_date: '2026-04-01',
          special_cap_eligible: true,
        }),
      }),
    });
    expect(visitScheduleProposalBatchCreateMock).toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).toHaveBeenCalled();
  });

  it('rejects special-cap proposal generation at the special monthly cap before write side effects', async () => {
    generateVisitScheduleProposalDraftsMock.mockReset();
    visitScheduleCountMock.mockReset();
    visitScheduleFindManyMock.mockReset();
    visitScheduleProposalFindManyMock.mockReset();
    visitScheduleProposalRouteFindManyMock.mockReset();
    generateVisitScheduleProposalDraftsMock.mockResolvedValueOnce({
      drafts: [
        {
          org_id: 'org_1',
          case_id: 'case_1',
          proposed_pharmacist_id: 'user_2',
          proposed_date: new Date('2026-04-03T00:00:00.000Z'),
          site_id: 'site_1',
          route_order: 1,
        },
      ],
      diagnostics: {
        accepted: [],
        rejected: [],
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
    visitScheduleCountMock.mockImplementation(async (args: unknown) => {
      const where = (args as { where?: Record<string, unknown> }).where;
      return where && 'case_' in where ? 8 : 0;
    });
    visitScheduleFindManyMock.mockResolvedValue(
      Array.from({ length: 8 }, (_, index) => ({
        id: `schedule_${index}`,
        scheduled_date: new Date(`2026-04-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`),
        pharmacist_id: 'user_2',
        visit_type: 'regular',
        case_: { patient_id: 'patient_1' },
      })),
    );
    visitScheduleProposalFindManyMock.mockResolvedValue([]);
    visitScheduleProposalRouteFindManyMock.mockResolvedValue([]);

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
        special_cap_eligible: true,
        start_date: '2026-04-01',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('月上限8回を超過します'),
    });
    expect(visitScheduleProposalBatchCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects special-cap proposal generation when transaction-time cadence rows exceed the special monthly cap', async () => {
    generateVisitScheduleProposalDraftsMock.mockReset();
    visitScheduleCountMock.mockReset();
    visitScheduleFindManyMock.mockReset();
    visitScheduleProposalFindManyMock.mockReset();
    visitScheduleProposalRouteFindManyMock.mockReset();
    generateVisitScheduleProposalDraftsMock.mockResolvedValueOnce({
      drafts: [
        {
          org_id: 'org_1',
          case_id: 'case_1',
          proposed_pharmacist_id: 'user_2',
          proposed_date: new Date('2026-04-10T00:00:00.000Z'),
          site_id: 'site_1',
          route_order: 1,
        },
      ],
      diagnostics: {
        accepted: [],
        rejected: [],
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
    visitScheduleCountMock.mockImplementation(async (args: unknown) => {
      const where = (args as { where?: Record<string, unknown> }).where;
      return where && 'case_' in where ? 7 : 0;
    });
    visitScheduleFindManyMock.mockResolvedValue(
      Array.from({ length: 8 }, (_, index) => ({
        id: `schedule_${index}`,
        scheduled_date: new Date(`2026-04-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`),
        pharmacist_id: 'user_2',
        visit_type: 'regular',
        case_: { patient_id: 'patient_1' },
      })),
    );
    visitScheduleProposalFindManyMock.mockResolvedValue([]);
    visitScheduleProposalRouteFindManyMock.mockResolvedValue([]);

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
        special_cap_eligible: true,
        start_date: '2026-04-01',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('月上限8回を超過します'),
    });
    expect(withOrgContextMock).toHaveBeenCalled();
    expect(visitScheduleProposalBatchCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('does not count open proposals that the same generation transaction will supersede', async () => {
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
    const supersededProposalRow = {
      id: 'proposal_superseded',
      case_id: 'case_1',
      proposal_batch_id: null,
      proposed_date: new Date('2026-04-03T00:00:00.000Z'),
      proposed_pharmacist_id: 'user_2',
      visit_type: 'regular',
      finalized_schedule_id: null,
      reschedule_source_schedule_id: null,
      case_: { patient_id: 'patient_1' },
    };
    visitScheduleCountMock.mockImplementation(async (args: unknown) => {
      const where = (args as { where?: Record<string, unknown> }).where;
      return where && 'case_' in where ? 3 : 0;
    });
    visitScheduleFindManyMock
      .mockResolvedValueOnce(
        ['2026-04-01', '2026-04-08', '2026-04-15'].map((date, index) => ({
          id: `schedule_${index}`,
          scheduled_date: new Date(`${date}T00:00:00.000Z`),
          pharmacist_id: 'user_2',
          visit_type: 'regular',
          case_: { patient_id: 'patient_1' },
        })),
      )
      .mockResolvedValueOnce([]);
    visitScheduleProposalFindManyMock.mockResolvedValue([supersededProposalRow]);
    visitScheduleProposalRouteFindManyMock
      .mockResolvedValueOnce([supersededProposalRow])
      .mockResolvedValueOnce([supersededProposalRow])
      .mockResolvedValueOnce([]);
    visitScheduleProposalCreateMock.mockImplementationOnce(({ data }) =>
      Promise.resolve({ id: 'proposal_replacement', ...data }),
    );

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedule-proposals', {
        case_id: 'case_1',
        visit_type: 'regular',
        candidate_count: 1,
        start_date: '2026-04-01',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(visitScheduleProposalUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        org_id: 'org_1',
        case_id: 'case_1',
        proposal_status: { in: ['proposed', 'patient_contact_pending', 'reschedule_pending'] },
        reschedule_source_schedule_id: null,
      }),
      data: { proposal_status: 'superseded' },
    });
    expect(visitScheduleProposalCreateMock).toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).toHaveBeenCalled();
  });
});
