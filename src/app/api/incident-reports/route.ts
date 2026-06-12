import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import {
  createIncidentReportSchema,
  incidentStatusSchema,
} from '@/lib/validations/incident-report';

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get('status');
    const status = statusParam ? incidentStatusSchema.safeParse(statusParam) : null;
    if (status && !status.success) {
      return validationError('ヒヤリハットステータスが不正です', {
        status: ['対応していないステータスです'],
      });
    }

    const reports = await prisma.incidentReport.findMany({
      where: {
        org_id: ctx.orgId,
        ...(status ? { status: status.data } : {}),
      },
      orderBy: [{ created_at: 'desc' }],
      take: 100,
      select: {
        id: true,
        title: true,
        what_happened: true,
        cause: true,
        immediate_action: true,
        prevention_plan: true,
        related_process: true,
        severity: true,
        status: true,
        occurred_at: true,
        reported_by: true,
        created_at: true,
        updated_at: true,
      },
    });

    return success({ data: reports });
  },
  {
    permission: 'canViewDashboard',
    message: 'ヒヤリハット記録の閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createIncidentReportSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const report = await withOrgContext(ctx.orgId, async (tx) => {
      const created = await tx.incidentReport.create({
        data: {
          org_id: ctx.orgId,
          reported_by: ctx.userId,
          title: parsed.data.title,
          what_happened: parsed.data.what_happened ?? null,
          cause: parsed.data.cause ?? null,
          immediate_action: parsed.data.immediate_action ?? null,
          prevention_plan: parsed.data.prevention_plan ?? null,
          related_process: parsed.data.related_process ?? null,
          ...(parsed.data.severity ? { severity: parsed.data.severity } : {}),
          occurred_at: parsed.data.occurred_at ? new Date(parsed.data.occurred_at) : null,
        },
      });

      // 医療安全記録のため作成を必ず監査ログに残す(自由記述本文は changes に含めない)
      await createAuditLogEntry(tx, ctx, {
        action: 'incident_report_created',
        targetType: 'IncidentReport',
        targetId: created.id,
        changes: {
          title: created.title,
          severity: created.severity,
          status: created.status,
          related_process: created.related_process,
        },
      });

      return created;
    });

    return success({ data: report }, 201);
  },
  {
    permission: 'canViewDashboard',
    message: 'ヒヤリハット記録の作成権限がありません',
  },
);
