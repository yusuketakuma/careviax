import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth, AuthenticatedRequest } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db';
import { validationError } from '@/lib/api/response';

const querySchema = z.object({
  format: z.enum(['csv', 'json']).default('csv'),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

function toCsvRow(values: unknown[]): string {
  return values
    .map((v) => {
      const s = v == null ? '' : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    })
    .join(',');
}

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const searchParams = req.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    format: searchParams.get('format') ?? undefined,
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
  });

  if (!parsed.success) {
    return validationError('クエリパラメータが不正です', parsed.error.flatten()) as NextResponse;
  }

  const { format, from, to } = parsed.data;

  const where = {
    org_id: req.orgId,
    ...((from ?? to)
      ? {
          created_at: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {}),
  };

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { created_at: 'desc' },
  });

  if (format === 'json') {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(JSON.stringify(logs, null, 2)));
        controller.close();
      },
    });
    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="audit-logs-${Date.now()}.json"`,
      },
    });
  }

  // CSV format
  const headers = ['id', 'org_id', 'actor_id', 'action', 'target_type', 'target_id', 'changes', 'ip_address', 'user_agent', 'created_at'];
  const csvHeader = toCsvRow(headers);
  const csvRows = logs.map((log) =>
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
    ])
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
    },
  });
}, {
  permission: 'canAdmin',
  message: '監査ログのエクスポートには管理者権限が必要です',
});
