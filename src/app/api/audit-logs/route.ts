import { prisma } from '@/lib/db/client';
import { success, validationError } from '@/lib/api/response';
import { withAuthContext } from '@/lib/auth/context';
import { parseAuditLogFilters } from '@/lib/api/audit-log-filters';
import { buildPagination } from '@/lib/api/search';
import { parseBoundedInteger } from '@/lib/api/pagination';
import { redactAuditLogsForResponse } from '@/lib/audit-logs/redaction';

const DEFAULT_AUDIT_LOG_PAGE = 1;
const DEFAULT_AUDIT_LOG_LIMIT = 20;
const MAX_AUDIT_LOG_PAGE = 10_000;
const MAX_AUDIT_LOG_LIMIT = 100;

export const GET = withAuthContext(
  async (req, ctx) => {
    const url = 'nextUrl' in req && req.nextUrl ? req.nextUrl : new URL(req.url);
    const filters = parseAuditLogFilters(url.searchParams);
    if ('error' in filters) {
      return validationError(filters.error);
    }
    const page = parseBoundedInteger(
      url.searchParams.get('page'),
      DEFAULT_AUDIT_LOG_PAGE,
      1,
      MAX_AUDIT_LOG_PAGE,
    );
    const limit = parseBoundedInteger(
      url.searchParams.get('limit'),
      DEFAULT_AUDIT_LOG_LIMIT,
      1,
      MAX_AUDIT_LOG_LIMIT,
    );

    const { skip, take } = buildPagination(page, limit, MAX_AUDIT_LOG_PAGE);

    const where = {
      org_id: ctx.orgId,
      ...(filters.actor ? { actor_id: filters.actor } : {}),
      ...(filters.actorPharmacy ? { actor_pharmacy_id: filters.actorPharmacy } : {}),
      ...(filters.actorSite ? { actor_site_id: filters.actorSite } : {}),
      ...(filters.patient ? { patient_id: filters.patient } : {}),
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
      data: redactAuditLogsForResponse(logs),
      pagination: {
        total,
        page: Math.floor(skip / take) + 1,
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    });
  },
  { permission: 'canAdmin' },
);
