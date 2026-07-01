import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { boundedIntegerSearchParam, parseSearchParams } from '@/lib/api/validation';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

const ROUTE = '/api/drug-master-import-logs';

const importSourceSchema = z.enum([
  'ssk',
  'mhlw_price',
  'mhlw_generic',
  'hot',
  'pmda',
  'manual_clinical',
]);
const importStatusSchema = z.enum(['pending', 'running', 'completed', 'failed']);

const importLogQuerySchema = z.object({
  limit: boundedIntegerSearchParam('limit', 1, 50, 10),
});

async function authenticatedGET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '医薬品マスター取込履歴の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const { searchParams } = new URL(req.url);
    const parsedQuery = parseSearchParams(importLogQuerySchema, searchParams);
    if (!parsedQuery.ok) {
      return validationError('入力値が不正です', parsedQuery.error.flatten().fieldErrors);
    }

    const sourceParam = searchParams.get('source');
    const statusParam = searchParams.get('status');
    const source = sourceParam ? importSourceSchema.safeParse(sourceParam) : null;
    const status = statusParam ? importStatusSchema.safeParse(statusParam) : null;

    if (source && !source.success) {
      return validationError('薬剤マスタ取込ソースが不正です', {
        source: ['対応していない取込ソースです'],
      });
    }
    if (status && !status.success) {
      return validationError('薬剤マスタ取込ステータスが不正です', {
        status: ['対応していない取込ステータスです'],
      });
    }

    const where: Prisma.DrugMasterImportLogWhereInput = {};

    if (source) {
      where.source = source.data;
    }
    if (status) {
      where.status = status.data;
    }

    const logs = await prisma.drugMasterImportLog.findMany({
      where,
      orderBy: [{ imported_at: 'desc' }, { created_at: 'desc' }],
      take: parsedQuery.data.limit,
      select: {
        id: true,
        source: true,
        imported_at: true,
        record_count: true,
        status: true,
        error_log: true,
        source_url: true,
        source_file_hash: true,
        source_published_at: true,
        import_mode: true,
        change_summary: true,
        created_at: true,
        updated_at: true,
      },
    });

    return success({ data: logs });
  });
}

export async function GET(
  req: NextRequest,
  _routeContext: { params: Promise<Record<string, string>> },
) {
  void _routeContext;
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'drug_master_import_logs_get_unhandled_error',
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
