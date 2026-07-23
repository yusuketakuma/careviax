import { beforeEach, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withAuthContextOptions,
  withOrgContextMock,
  inquiryRecordFindFirstMock,
  prescriptionLineFindFirstMock,
  resolveOperationalTasksMock,
  notifyWorkflowMutationMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withAuthContextOptions: [] as unknown[],
  withOrgContextMock: vi.fn(),
  inquiryRecordFindFirstMock: vi.fn(),
  prescriptionLineFindFirstMock: vi.fn(),
  resolveOperationalTasksMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => Promise<Response>, options?: unknown) => {
    withAuthContextOptions.push(options);
    return async (req: NextRequest, routeContext: unknown) => {
      const authResult = await requireAuthContextMock(req, options);
      if ('response' in authResult) {
        authResult.response.headers.set('Cache-Control', 'private, no-store, max-age=0');
        authResult.response.headers.set('Pragma', 'no-cache');
        return authResult.response;
      }
      const response = await handler(req, authResult.ctx, routeContext);
      response.headers.set('Cache-Control', 'private, no-store, max-age=0');
      response.headers.set('Pragma', 'no-cache');
      return response;
    };
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    inquiryRecord: {
      findFirst: inquiryRecordFindFirstMock,
    },
    prescriptionLine: {
      findFirst: prescriptionLineFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/operational-tasks', () => ({
  resolveOperationalTasks: resolveOperationalTasksMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/inquiry-records/inquiry_1', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/inquiry-records/inquiry_1', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: '{"result":',
  });
}

function expectNoInquiryPatchSideEffects() {
  expect(inquiryRecordFindFirstMock).not.toHaveBeenCalled();
  expect(prescriptionLineFindFirstMock).not.toHaveBeenCalled();
  expect(withOrgContextMock).not.toHaveBeenCalled();
  expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
}

export function getInquiryRecordPatchTestSupport() {
  return {
    requireAuthContextMock,
    withAuthContextOptions,
    withOrgContextMock,
    inquiryRecordFindFirstMock,
    prescriptionLineFindFirstMock,
    resolveOperationalTasksMock,
    notifyWorkflowMutationMock,
    loggerErrorMock,
    createRequest,
    createMalformedJsonRequest,
    expectNoInquiryPatchSideEffects,
  };
}

export function registerInquiryRecordPatchBeforeEach() {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    prescriptionLineFindFirstMock.mockResolvedValue({
      id: 'line_1',
      drug_name: 'アムロジピン錠5mg',
      drug_code: 'YJ123',
      dose: '1錠',
      frequency: '1日1回',
      days: 7,
      packaging_instructions: null,
      route: 'internal',
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
    });
  });
}
