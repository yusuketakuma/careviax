import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { validationError } from '@/lib/api/response';
import { parseAuditLogFilters } from '@/lib/api/audit-log-filters';
import { redactAuditLogsForResponse } from '@/lib/audit-logs/redaction';
import { recordDataExportAudit } from '@/server/services/export-audit';

const querySchema = z.object({
  format: z.enum(['csv', 'json']).default('csv'),
});

function toCsvRow(values: unknown[]): string {
  return values
    .map((v) => {
      const s = v == null ? '' : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    })
    .join(',');
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const searchParams = req.nextUrl.searchParams;
    const parsed = querySchema.safeParse({
      format: searchParams.get('format') ?? undefined,
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
    });

    if (!parsed.success) {
      return validationError('クエリパラメータが不正です', parsed.error.flatten()) as NextResponse;
    }

    const filters = parseAuditLogFilters(searchParams);
    if ('error' in filters) {
      return validationError(filters.error) as NextResponse;
    }

    const { format } = parsed.data;

    const where = {
      org_id: ctx.orgId,
      ...(filters.actor ? { actor_id: filters.actor } : {}),
      ...(filters.targetType ? { target_type: filters.targetType } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      ...((filters.from ?? filters.to)
        ? {
            created_at: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
    };

    const EXPORT_LIMIT = 10000;
    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: EXPORT_LIMIT,
    });
    const truncated = logs.length === EXPORT_LIMIT;
    const exportLogs = redactAuditLogsForResponse(logs);

    await recordDataExportAudit(prisma, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      targetType: 'audit_log',
      format,
      recordCount: logs.length,
      filters: {
        actor: filters.actor ?? null,
        targetType: filters.targetType ?? null,
        action: filters.action ?? null,
        from: filters.from?.toISOString() ?? null,
        to: filters.to?.toISOString() ?? null,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    if (format === 'json') {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(JSON.stringify(exportLogs, null, 2)));
          controller.close();
        },
      });
      return new NextResponse(stream, {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="audit-logs-${Date.now()}.json"`,
          ...(truncated
            ? { 'X-Export-Truncated': 'true', 'X-Export-Limit': String(EXPORT_LIMIT) }
            : {}),
        },
      });
    }

    // CSV format
    const headers = [
      'id',
      'org_id',
      'actor_id',
      'action',
      'target_type',
      'target_id',
      'changes',
      'ip_address',
      'user_agent',
      'created_at',
    ];
    const csvHeader = toCsvRow(headers);
    const csvRows = exportLogs.map((log) =>
      toCsvRow([
        log.id,
        log.org_id,
        log.actor_id,
        log.action,
        log.target_type,
        log.target_id,
        log.changes != null ? JSON.stringify(log.changes) : '',
        log.ip_address ?? '',
        log.user_agent ?? '',
        log.created_at.toISOString(),
      ]),
    );

    const csv = [csvHeader, ...csvRows].join('\n');
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(csv));
        controller.close();
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit-logs-${Date.now()}.csv"`,
        ...(truncated
          ? { 'X-Export-Truncated': 'true', 'X-Export-Limit': String(EXPORT_LIMIT) }
          : {}),
      },
    });
  },
  {
    permission: 'canAdmin',
    message: '監査ログのエクスポートには管理者権限が必要です',
  },
);
