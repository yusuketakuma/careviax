import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { forbidden, notFound, success, validationError } from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { hasPermission } from '@/lib/auth/permissions';
import { prisma } from '@/lib/db/client';
import { updateIncidentReportSchema } from '@/lib/validations/incident-report';

export const PATCH = withAuthContext<{ id: string }>(
  async (req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('ヒヤリハット記録IDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = updateIncidentReportSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    // ステータス変更(確認済み/クローズ)は管理者のみ
    if (parsed.data.status !== undefined && !hasPermission(ctx.role, 'canAdmin')) {
      return forbidden('ステータスの変更には管理者権限が必要です');
    }

    const existing = await prisma.incidentReport.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true },
    });
    if (!existing) return notFound('ヒヤリハット記録が見つかりません');

    const updatedFields = Object.entries(parsed.data)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);

    const report = await withOrgContext(ctx.orgId, async (tx) => {
      const updated = await tx.incidentReport.update({
        where: { id },
        data: {
          ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
          ...(parsed.data.what_happened !== undefined
            ? { what_happened: parsed.data.what_happened }
            : {}),
          ...(parsed.data.cause !== undefined ? { cause: parsed.data.cause } : {}),
          ...(parsed.data.immediate_action !== undefined
            ? { immediate_action: parsed.data.immediate_action }
            : {}),
          ...(parsed.data.prevention_plan !== undefined
            ? { prevention_plan: parsed.data.prevention_plan }
            : {}),
          ...(parsed.data.related_process !== undefined
            ? { related_process: parsed.data.related_process }
            : {}),
          ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
        },
      });

      // 医療安全記録のため更新を必ず監査ログに残す(自由記述本文は changes に含めない)
      await createAuditLogEntry(tx, ctx, {
        action: 'incident_report_updated',
        targetType: 'IncidentReport',
        targetId: updated.id,
        changes: {
          title: updated.title,
          severity: updated.severity,
          status: updated.status,
          related_process: updated.related_process,
          updated_fields: updatedFields,
        },
      });

      return updated;
    });

    return success({ data: report });
  },
  {
    permission: 'canViewDashboard',
    message: 'ヒヤリハット記録の更新権限がありません',
  },
);
