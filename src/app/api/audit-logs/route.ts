import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth, AuthenticatedRequest } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';

const querySchema = z.object({
  actor: z.string().optional(),
  target: z.string().optional(),
  action: z.string().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const searchParams = req.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    actor: searchParams.get('actor') ?? undefined,
    target: searchParams.get('target') ?? undefined,
    action: searchParams.get('action') ?? undefined,
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
    cursor: searchParams.get('cursor') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
  });

  if (!parsed.success) {
    return validationError('クエリパラメータが不正です', parsed.error.flatten()) as NextResponse;
  }

  const { cursor, limit } = parsePaginationParams(searchParams);
  const { actor, target, action, from, to } = parsed.data;

  const where = {
    org_id: req.orgId,
    ...(actor ? { actor_id: actor } : {}),
    ...(target ? { target_id: target } : {}),
    ...(action ? { action } : {}),
    ...((from ?? to)
      ? {
          created_at: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {}),
  };

  const [logs, totalCount] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
    prisma.auditLog.count({ where }),
  ]);

  const hasMore = logs.length > limit;
  const data = hasMore ? logs.slice(0, limit) : logs;
  const nextCursor = hasMore ? data[data.length - 1].id : undefined;
  return success({ data, nextCursor, hasMore, totalCount }) as NextResponse;
}, {
  permission: 'canAdmin',
  message: '監査ログの閲覧には管理者権限が必要です',
});
