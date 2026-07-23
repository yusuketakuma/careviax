import { beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const {
  authMock,
  buildSetPlanAssignmentWhereMock,
  loggerErrorMock,
  prismaMock,
  withOrgContextMock,
  txMock,
  notifyWorkflowMutationMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  buildSetPlanAssignmentWhereMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
  },
  withOrgContextMock: vi.fn(),
  txMock: {
    setPlan: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    prescriptionIntake: { findMany: vi.fn() },
    setBatch: {
      count: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    setBatchChangeLog: {
      create: vi.fn(),
    },
    dispenseResult: {
      findFirst: vi.fn(),
    },
    dispensingDecision: {
      findFirst: vi.fn(),
    },
    drugMaster: {
      findMany: vi.fn(),
    },
  },
  notifyWorkflowMutationMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

vi.mock('@/server/services/prescription-access', () => ({
  buildSetPlanAssignmentWhere: buildSetPlanAssignmentWhereMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { POST } from '../route';
import { expectNoStore } from '@/test/api-response-assertions';

const CURRENT_UPDATED_AT = '2026-03-01T00:00:00.000Z';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/set-plans/plan_1/generate-batches', {
    method: 'POST',
    headers: {
      'x-org-id': 'org_1',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function createEmptyRequest() {
  return new NextRequest('http://localhost/api/set-plans/plan_1/generate-batches', {
    method: 'POST',
    headers: {
      'x-org-id': 'org_1',
    },
  });
}

function createMalformedRequest() {
  return new NextRequest('http://localhost/api/set-plans/plan_1/generate-batches', {
    method: 'POST',
    headers: {
      'x-org-id': 'org_1',
      'content-type': 'application/json',
    },
    body: '{"force":',
  });
}

function buildSerializableConflictError() {
  return new Prisma.PrismaClientKnownRequestError('Serializable transaction conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

export function getGenerateBatchesRouteTestSupport() {
  return {
    authMock,
    buildSetPlanAssignmentWhereMock,
    loggerErrorMock,
    prismaMock,
    withOrgContextMock,
    txMock,
    notifyWorkflowMutationMock,
    CURRENT_UPDATED_AT,
    createRequest,
    createEmptyRequest,
    createMalformedRequest,
    buildSerializableConflictError,
    POST,
    expectNoStore,
  };
}

export function registerGenerateBatchesBeforeEach() {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    buildSetPlanAssignmentWhereMock.mockReturnValue(null);
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin', site_id: null });
    txMock.setPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      cycle_id: 'cycle_1',
      target_period_start: new Date('2026-03-01T00:00:00.000Z'),
      target_period_end: new Date('2026-03-02T00:00:00.000Z'),
      set_method: 'custom',
      packaging_method_id: null,
      packaging_method_ref: null,
      updated_at: new Date(CURRENT_UPDATED_AT),
      cycle: {
        overall_status: 'audited',
        case_: {
          patient: {
            packaging_profile: null,
          },
        },
      },
    });
    txMock.prescriptionIntake.findMany.mockResolvedValue([
      {
        updated_at: new Date('2026-03-01T00:00:00.000Z'),
        lines: [
          {
            id: 'line_1',
            drug_name: 'Drug',
            frequency: '朝夕',
            quantity: 2,
            unit: '錠',
            packaging_group_id: null,
            packaging_method: null,
            packaging_instructions: null,
            packaging_instruction_tags: [],
            notes: null,
            dispensing_decisions: [],
            dispense_results: [
              {
                id: 'result_1',
                actual_quantity: 2,
                actual_unit: '錠',
                updated_at: new Date('2026-03-01T10:00:00.000Z'),
              },
            ],
          },
        ],
      },
    ]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(txMock));
    txMock.setPlan.updateMany.mockResolvedValue({ count: 1 });
    txMock.dispenseResult.findFirst.mockResolvedValue({
      updated_at: new Date('2026-03-01T10:00:00.000Z'),
    });
    txMock.dispensingDecision.findFirst.mockResolvedValue(null);
    txMock.drugMaster.findMany.mockResolvedValue([]);
  });
}
