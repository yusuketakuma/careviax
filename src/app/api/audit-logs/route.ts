import { prisma } from '@/lib/db/client';
import { success, validationError } from '@/lib/api/response';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { parseAuditLogFilters } from '@/lib/api/audit-log-filters';
import { buildPagination } from '@/lib/api/search';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const url = 'nextUrl' in req && req.nextUrl ? req.nextUrl : new URL(req.url);
  const filters = parseAuditLogFilters(url.searchParams);
  if ('error' in filters) {
    return validationError(filters.error);
  }
  const page = url.searchParams.get('page')
    ? Number(url.searchParams.get('page'))
    : undefined;
  const limit = url.searchParams.get('limit')
    ? Number(url.searchParams.get('limit'))
    : undefined;

  const { skip, take } = buildPagination(page, limit);

  const where = {
    org_id: req.orgId,
    ...(filters.actor ? { actor_id: filters.actor } : {}),
    ...(filters.targetType ? { target_type: filters.targetType } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.from || filters.to
      ? {
          created_at: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
  };

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return success({
    data: logs,
    pagination: {
      total,
      page: Math.floor(skip / take) + 1,
      limit: take,
      totalPages: Math.ceil(total / take),
    },
  });
}, { permission: 'canAdmin' });
