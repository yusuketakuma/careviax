import { unstable_rethrow } from 'next/navigation';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { readOptionalJsonObjectRequestBody } from '@/lib/api/request-body';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';
import {
  buildOnboardingRenewalBoard,
  normalizeRenewalBoardLimit,
  normalizeRenewalBoardWindowDays,
  syncOnboardingRenewalTasks,
} from '@/server/services/management-plans';

const ROUTE = '/api/onboarding/renewal-board';

const renewalBoardQuerySchema = z.object({
  window_days: z.coerce.number().int().min(1).max(180).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const renewalBoardSyncSchema = z.object({
  window_days: z.number().int().min(1).max(180).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

function parseQuery(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const raw = {
    window_days: searchParams.get('window_days') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
  };
  const parsed = renewalBoardQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', parsed.error.flatten().fieldErrors),
    };
  }
  return { ok: true as const, data: parsed.data };
}

async function authenticatedGET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canViewDashboard',
    message: '同意・管理計画更新ボードの閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const parsed = parseQuery(req);
  if (!parsed.ok) return parsed.response;

  const board = await withOrgContext(
    ctx.orgId,
    (tx) =>
      buildOnboardingRenewalBoard(tx, {
        orgId: ctx.orgId,
        windowDays: normalizeRenewalBoardWindowDays(parsed.data.window_days),
        limit: normalizeRenewalBoardLimit(parsed.data.limit),
      }),
    { requestContext: ctx },
  );

  return success({ data: board });
}

async function authenticatedPOST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canViewDashboard',
    message: '同意・管理計画更新タスクの同期権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const payload = await readOptionalJsonObjectRequestBody(req);
  if (payload == null) return validationError('リクエストボディが不正です');
  const parsed = renewalBoardSyncSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const result = await withOrgContext(
    ctx.orgId,
    (tx) =>
      syncOnboardingRenewalTasks(tx, {
        orgId: ctx.orgId,
        windowDays: normalizeRenewalBoardWindowDays(parsed.data.window_days),
        limit: normalizeRenewalBoardLimit(parsed.data.limit),
      }),
    { requestContext: ctx },
  );

  return success({ data: result });
}

export async function GET(req: NextRequest) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'onboarding_renewal_board_unhandled_error',
          route: ROUTE,
          method: req.method,
          status: 500,
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  });
}

export async function POST(req: NextRequest) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedPOST(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'onboarding_renewal_board_unhandled_error',
          route: ROUTE,
          method: req.method,
          status: 500,
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  });
}
