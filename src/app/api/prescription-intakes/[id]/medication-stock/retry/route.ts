import { Prisma } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withOrgContext } from '@/lib/db/rls';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { buildPrescriptionIntakeAssignmentWhere } from '@/server/services/prescription-access';
import { requireWritablePatient } from '@/server/services/patient-write-guard';
import { applyPrescriptionSupplyForIntake } from '@/modules/pharmacy';

export const dynamic = 'force-dynamic';

const authenticatedPOST = withAuthContext(
  async (_req: NextRequest, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id: rawId } = await routeContext.params;
    const intakeId = normalizeRequiredRouteParam(rawId);
    if (!intakeId) return validationError('処方受付IDが不正です');

    const assignmentWhere = buildPrescriptionIntakeAssignmentWhere(ctx);
    const outcome = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const intake = await tx.prescriptionIntake.findFirst({
          where: {
            id: intakeId,
            org_id: ctx.orgId,
            ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
          },
          select: {
            id: true,
            cycle: { select: { patient_id: true } },
          },
        });
        if (!intake?.cycle.patient_id) return { kind: 'not_found' as const };

        const writablePatient = await requireWritablePatient(tx, ctx, intake.cycle.patient_id);
        if ('response' in writablePatient) {
          return { kind: 'response' as const, response: writablePatient.response };
        }

        const result = await applyPrescriptionSupplyForIntake(tx, {
          orgId: ctx.orgId,
          userId: ctx.userId,
          intakeId: intake.id,
          patientId: intake.cycle.patient_id,
        });
        const resultCounts = result.results.reduce<Record<string, number>>((counts, item) => {
          counts[item.kind] = (counts[item.kind] ?? 0) + 1;
          return counts;
        }, {});

        await createAuditLogEntry(tx, ctx, {
          action: 'medication_stock.prescription_supply_retry',
          targetType: 'PrescriptionIntake',
          targetId: intake.id,
          patientId: intake.cycle.patient_id,
          changes: {
            applied_count: result.applied_count,
            review_required_count: result.review_required_count,
            skipped_count: result.skipped_count,
            idempotent_replay_count: result.results.filter(
              (item) => item.kind === 'applied' && item.idempotent_replay,
            ).length,
            result_counts: resultCounts,
          },
        });

        return { kind: 'completed' as const, result };
      },
      {
        requestContext: ctx,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeoutMs: 10_000,
      },
    );

    if (outcome.kind === 'not_found') return notFound('処方受付が見つかりません');
    if (outcome.kind === 'response') return outcome.response;
    return success({ data: outcome.result });
  },
  {
    permission: 'canDispense',
    message: '処方供給の残数台帳反映を再試行する権限がありません',
  },
);

export async function POST(req: NextRequest, routeContext: AuthRouteContext<{ id: string }>) {
  return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
}
