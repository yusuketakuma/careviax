import { beforeEach, vi } from 'vitest';
import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  careCaseFindManyMock,
  careCaseFindFirstMock,
  patientFindFirstMock,
  taskFindManyMock,
  userFindManyMock,
  membershipFindManyMock,
  taskFindFirstMock,
  taskCreateMock,
  withOrgContextMock,
  allocateDisplayIdMock,
  loggerErrorMock,
  runWithRequestAuthContextMock,
  withRoutePerformanceMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  userFindManyMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  taskCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  allocateDisplayIdMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
  withRoutePerformanceMock: vi.fn((_req, callback: () => unknown) => callback()),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (
      handler: (req: NextRequest, ctx: Record<string, unknown>) => Promise<Response>,
      options?: unknown,
    ) =>
    async (req: NextRequest) =>
      withRoutePerformanceMock(req, async () => {
        const noStore = (response: Response) => {
          response.headers.set('Cache-Control', 'private, no-store, max-age=0');
          response.headers.set('Pragma', 'no-cache');
          return response;
        };
        const authResult = await requireAuthContextMock(req, options);
        if ('response' in authResult) return noStore(authResult.response);
        return runWithRequestAuthContextMock(authResult.ctx, async () => {
          try {
            return noStore(await handler(req, authResult.ctx));
          } catch (error) {
            unstable_rethrow(error);
            loggerErrorMock(
              {
                event: 'route_handler_unhandled_error',
                route: req.nextUrl.pathname,
                method: req.method,
                requestId: authResult.ctx.requestId,
                correlationId: authResult.ctx.correlationId,
              },
              error,
            );
            return noStore(
              Response.json(
                { code: 'INTERNAL_ERROR', message: 'サーバー内部でエラーが発生しました' },
                { status: 500 },
              ),
            );
          }
        });
      }),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careCase: {
      findMany: careCaseFindManyMock,
      findFirst: careCaseFindFirstMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
    },
    task: {
      findMany: taskFindManyMock,
      findFirst: taskFindFirstMock,
    },
    user: {
      findMany: userFindManyMock,
    },
    membership: {
      findMany: membershipFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/display-id', () => ({
  allocateDisplayId: allocateDisplayIdMock,
}));

import {
  buildDefaultCreatedTask,
  createTaskAuthContext,
  installTaskCreateTransactionMock,
} from '../route.test-helpers';

export function getTasksRouteTestSupport() {
  return {
    requireAuthContextMock,
    careCaseFindManyMock,
    careCaseFindFirstMock,
    patientFindFirstMock,
    taskFindManyMock,
    userFindManyMock,
    membershipFindManyMock,
    taskFindFirstMock,
    taskCreateMock,
    withOrgContextMock,
    allocateDisplayIdMock,
    loggerErrorMock,
    runWithRequestAuthContextMock,
    withRoutePerformanceMock,
  };
}

export function registerTasksRouteBeforeEach() {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue(createTaskAuthContext('pharmacist'));
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);
    careCaseFindFirstMock.mockResolvedValue({ patient_id: 'patient_1' });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1', archived_at: null });
    taskFindManyMock.mockResolvedValue([]);
    userFindManyMock.mockResolvedValue([]);
    membershipFindManyMock.mockResolvedValue([
      { user_id: 'user_1', role: 'pharmacist', can_audit_dispense: true },
    ]);
    taskFindFirstMock.mockResolvedValue(null);
    taskCreateMock.mockResolvedValue(buildDefaultCreatedTask());
    allocateDisplayIdMock.mockResolvedValue('t0000000001');
    installTaskCreateTransactionMock(withOrgContextMock, taskCreateMock);
  });
}
