import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { dispatchNotificationEvent } from '@/server/services/notifications';
import { z } from 'zod';

const dispenseResultLineSchema = z.object({
  line_id: z.string().min(1),
  actual_drug_name: z.string().min(1, '実薬剤名は必須です'),
  actual_drug_code: z.string().optional(),
  actual_quantity: z.number().positive('数量は正の数を入力してください'),
  actual_unit: z.string().optional(),
  discrepancy_reason: z.string().optional(),
  carry_type: z.enum(['carry', 'facility_deposit', 'deferred']),
  special_notes: z.string().optional(),
});

const createDispenseResultSchema = z.object({
  task_id: z.string().min(1),
  lines: z.array(dispenseResultLineSchema).min(1, '調剤実績を1件以上入力してください'),
});

function resolveCarryItemsStatus(lines: Array<{ carry_type: string | null | undefined }>) {
  const hasDeferred = lines.some((line) => line.carry_type === 'deferred');
  const hasReadyItem = lines.some(
    (line) => line.carry_type === 'carry' || line.carry_type === 'facility_deposit'
  );

  if (!hasDeferred) return 'ready' as const;
  if (hasReadyItem) return 'partial' as const;
  return 'blocked' as const;
}

function buildDiscrepancyReasonErrors(input: {
  submittedLines: Array<z.infer<typeof dispenseResultLineSchema>>;
  prescribedLines: Array<{
    id: string;
    drug_name: string;
    drug_code: string | null;
    quantity: number | null;
  }>;
}) {
  const prescribedByLineId = new Map(
    input.prescribedLines.map((line) => [line.id, line])
  );

  return input.submittedLines.flatMap((line) => {
    const prescribed = prescribedByLineId.get(line.line_id);
    if (!prescribed) return [];

    const hasDrugDiff =
      line.actual_drug_name !== prescribed.drug_name ||
      (line.actual_drug_code?.trim() || null) !== (prescribed.drug_code?.trim() || null);
    const hasQuantityDiff =
      prescribed.quantity != null && line.actual_quantity !== prescribed.quantity;
    const requiresReason = hasDrugDiff || hasQuantityDiff || line.carry_type === 'deferred';

    if (!requiresReason || line.discrepancy_reason?.trim()) return [];

    return [
      {
        line_id: line.line_id,
        prescribed_drug_name: prescribed.drug_name,
        reason: line.carry_type === 'deferred'
          ? '後日対応時は理由コードが必須です'
          : '処方との差異があるため理由コードが必須です',
      },
    ];
  });
}

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createDispenseResultSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { task_id, lines } = parsed.data;

  const result = await withOrgContext(req.orgId, async (tx) => {
    // Verify task belongs to this org
    const task = await tx.dispenseTask.findFirst({
      where: { id: task_id, org_id: req.orgId },
      include: {
        results: {
          select: {
            id: true,
            line_id: true,
            actual_drug_name: true,
            actual_drug_code: true,
            actual_quantity: true,
            actual_unit: true,
            carry_type: true,
            special_notes: true,
          },
        },
        cycle: {
          select: {
            id: true,
            overall_status: true,
            inquiries: {
              where: {
                OR: [{ result: null }, { result: 'pending' }],
              },
              select: {
                id: true,
                line_id: true,
                reason: true,
                inquiry_to_physician: true,
              },
            },
            prescription_intakes: {
              orderBy: { created_at: 'desc' },
              take: 1,
              select: {
                id: true,
                lines: {
                  select: {
                    id: true,
                    drug_name: true,
                    drug_code: true,
                    quantity: true,
                  },
                },
              },
            },
            visit_schedules: {
              where: {
                schedule_status: { in: ['planned', 'in_preparation', 'ready'] },
              },
              select: { id: true },
              take: 1,
            },
            case_: {
              select: {
                patient: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!task) return null;

    const blockedInquiryByLineId = new Map(
      task.cycle.inquiries
        .filter((item) => item.line_id)
        .map((item) => [
          item.line_id as string,
          `${item.reason}${item.inquiry_to_physician ? ` / ${item.inquiry_to_physician}` : ''}`,
        ])
    );
    const cycleLevelInquiries = task.cycle.inquiries.filter((item) => item.line_id == null);

    if (cycleLevelInquiries.length > 0) {
      return {
        error: 'cycle_blocked' as const,
        reasons: cycleLevelInquiries.map(
          (item) => `${item.reason}${item.inquiry_to_physician ? ` / ${item.inquiry_to_physician}` : ''}`
        ),
      };
    }

    const blockedLines = lines
      .map((line) => ({
        line_id: line.line_id,
        reason: blockedInquiryByLineId.get(line.line_id) ?? null,
      }))
      .filter((line): line is { line_id: string; reason: string } => line.reason != null);

    if (blockedLines.length > 0) {
      return {
        error: 'line_blocked' as const,
        reasons: blockedLines,
      };
    }

    const discrepancyReasonErrors = buildDiscrepancyReasonErrors({
      submittedLines: lines,
      prescribedLines: task.cycle.prescription_intakes[0]?.lines ?? [],
    });
    if (discrepancyReasonErrors.length > 0) {
      return {
        error: 'reason_required' as const,
        reasons: discrepancyReasonErrors,
      };
    }

    const now = new Date();
    const existingResultByLineId = new Map(task.results.map((item) => [item.line_id, item]));

    const results = await Promise.all(
      lines.map((line) =>
        existingResultByLineId.has(line.line_id)
          ? tx.dispenseResult.update({
              where: { id: existingResultByLineId.get(line.line_id)!.id },
              data: {
                actual_drug_name: line.actual_drug_name,
                actual_drug_code: line.actual_drug_code,
                actual_quantity: line.actual_quantity,
                actual_unit: line.actual_unit,
                discrepancy_reason: line.discrepancy_reason,
                carry_type: line.carry_type,
                special_notes: line.special_notes,
                dispensed_by: req.userId,
                dispensed_at: now,
              },
            })
          : tx.dispenseResult.create({
              data: {
                org_id: req.orgId,
                task_id,
                line_id: line.line_id,
                actual_drug_name: line.actual_drug_name,
                actual_drug_code: line.actual_drug_code,
                actual_quantity: line.actual_quantity,
                actual_unit: line.actual_unit,
                discrepancy_reason: line.discrepancy_reason,
                carry_type: line.carry_type,
                special_notes: line.special_notes,
                dispensed_by: req.userId,
                dispensed_at: now,
              },
            })
      )
    );

    const latestIntakeLineIds = task.cycle.prescription_intakes[0]?.lines.map((line) => line.id) ?? [];
    const completedLineIds = new Set([
      ...task.results.map((item) => item.line_id),
      ...results.map((item) => item.line_id),
    ]);
    const blockedLineIds = new Set(
      task.cycle.inquiries
        .map((item) => item.line_id)
        .filter((lineId): lineId is string => lineId != null)
    );
    const hasRemainingBlockedLine = latestIntakeLineIds.some((lineId) => blockedLineIds.has(lineId));
    const hasAllResults = latestIntakeLineIds.every((lineId) => completedLineIds.has(lineId));
    const canComplete =
      cycleLevelInquiries.length === 0 &&
      !hasRemainingBlockedLine &&
      latestIntakeLineIds.length > 0 &&
      hasAllResults;

    await tx.dispenseTask.update({
      where: { id: task_id },
      data: { status: canComplete ? 'completed' : 'in_progress' },
    });

    if (!canComplete) {
      if (task.cycle.overall_status !== 'inquiry_pending') {
        await tx.medicationCycle.update({
          where: { id: task.cycle_id },
          data: { overall_status: 'dispensing' },
        });
      }

      return { results, task_id, partial: true };
    }

    await tx.medicationCycle.update({
      where: { id: task.cycle_id },
      data: { overall_status: 'audit_pending' },
    });

    const auditRecipients = await tx.membership.findMany({
      where: {
        org_id: req.orgId,
        is_active: true,
        OR: [
          { can_audit_dispense: true },
          { role: { in: ['owner', 'admin'] as never[] } },
        ],
        user: {
          is_active: true,
        },
      },
      select: {
        user_id: true,
      },
    });

    const explicitUserIds = Array.from(new Set(auditRecipients.map((member) => member.user_id)));
    if (explicitUserIds.length > 0) {
      await dispatchNotificationEvent(tx, {
        orgId: req.orgId,
        eventType: 'dispense_audit_pending',
        type: 'business',
        title: '調剤鑑査待ちの処方があります',
        message: `${task.cycle.case_.patient.name} の調剤結果が鑑査待ちになりました`,
        link: `/auditing/${task_id}`,
        metadata: {
          task_id,
          cycle_id: task.cycle_id,
          priority: task.priority,
        },
        explicitUserIds,
        dedupeKey: `dispense-audit-pending:${task_id}`,
      });
    }

    const visitScheduleId = task.cycle.visit_schedules[0]?.id;
    if (visitScheduleId) {
      const persistedResults = await tx.dispenseResult.findMany({
        where: {
          org_id: req.orgId,
          task_id,
        },
        select: {
          line_id: true,
          actual_drug_name: true,
          actual_drug_code: true,
          actual_quantity: true,
          actual_unit: true,
          carry_type: true,
          special_notes: true,
        },
      });

      await tx.visitSchedule.update({
        where: { id: visitScheduleId },
        data: {
          carry_items: persistedResults.map((line) => ({
            line_id: line.line_id,
            drug_name: line.actual_drug_name,
            drug_code: line.actual_drug_code,
            quantity: line.actual_quantity,
            unit: line.actual_unit,
            carry_type: line.carry_type,
            special_notes: line.special_notes,
          })),
          carry_items_status: resolveCarryItemsStatus(persistedResults),
        },
      });
    }

    return { results, task_id, partial: false };
  });

  if (!result) return notFound('指定された調剤タスクが見つかりません');
  if ('error' in result) {
    if (result.error === 'cycle_blocked') {
      return validationError('疑義照会中のため調剤開始できません', {
        blocked_inquiries: result.reasons,
      });
    }
    if (result.error === 'line_blocked') {
      return validationError('疑義照会中の明細が含まれているため調剤完了できません', {
        blocked_lines: result.reasons,
      });
    }
    if (result.error === 'reason_required') {
      return validationError('差異/欠品/代替がある明細は理由コードを入力してください', {
        discrepancy_lines: result.reasons,
      });
    }
  }

  return success(result, 201);
}, {
  permission: 'canDispense',
  message: '調剤結果の登録権限がありません',
});
