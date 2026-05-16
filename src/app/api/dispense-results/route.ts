import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, conflict } from '@/lib/api/response';
import { dispatchNotificationEvent } from '@/server/services/notifications';
import { notifyWebhookEventForOrg } from '@/server/services/outbound-webhook';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import { checkDispenseAlerts } from '@/server/cds/checker';
import { buildMedicationCycleAssignmentWhere } from '@/server/services/prescription-access';
import {
  transitionCycleStatus,
  InvalidTransitionError,
  VersionConflictError,
} from '@/lib/db/cycle-transition';
import { DISPENSE_SAFETY_CHECKLIST_ACK } from '@/lib/dispensing/safety-checklist';
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
  is_unit_dose: z.boolean().optional(),
  is_crushed: z.boolean().optional(),
  packaging_group_id: z.string().optional(),
});

const dispenseSafetyChecklistSchema = z.object({
  patient_identity: z.literal(DISPENSE_SAFETY_CHECKLIST_ACK.patient_identity),
  drug_name_strength: z.literal(DISPENSE_SAFETY_CHECKLIST_ACK.drug_name_strength),
  quantity_days: z.literal(DISPENSE_SAFETY_CHECKLIST_ACK.quantity_days),
  directions_route: z.literal(DISPENSE_SAFETY_CHECKLIST_ACK.directions_route),
  packaging_storage: z.literal(DISPENSE_SAFETY_CHECKLIST_ACK.packaging_storage),
  cds_alerts_reviewed: z.literal(DISPENSE_SAFETY_CHECKLIST_ACK.cds_alerts_reviewed),
});

const createDispenseResultSchema = z.object({
  task_id: z.string().min(1),
  lines: z.array(dispenseResultLineSchema).min(1, '調剤実績を1件以上入力してください'),
  safety_checklist: dispenseSafetyChecklistSchema.optional(),
});

function resolveCarryItemsStatus(lines: Array<{ carry_type: string | null | undefined }>) {
  const hasDeferred = lines.some((line) => line.carry_type === 'deferred');
  const hasReadyItem = lines.some(
    (line) => line.carry_type === 'carry' || line.carry_type === 'facility_deposit',
  );

  if (!hasDeferred) return 'ready' as const;
  if (hasReadyItem) return 'partial' as const;
  return 'blocked' as const;
}

function countCdsAlertsBySeverity(alerts: Array<{ severity: 'critical' | 'warning' | 'info' }>) {
  return alerts.reduce(
    (counts, alert) => {
      counts[alert.severity] += 1;
      return counts;
    },
    { critical: 0, warning: 0, info: 0 },
  );
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
  const prescribedByLineId = new Map(input.prescribedLines.map((line) => [line.id, line]));

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
        reason:
          line.carry_type === 'deferred'
            ? '後日対応時は理由コードが必須です'
            : '処方との差異があるため理由コードが必須です',
      },
    ];
  });
}

async function promoteCycleToDispensingIfNeeded(args: {
  tx: Parameters<typeof transitionCycleStatus>[0];
  cycleId: string;
  orgId: string;
  userId: string;
  currentStatus: string;
}) {
  if (args.currentStatus === 'dispensing' || args.currentStatus === 'inquiry_pending') {
    return;
  }

  if (args.currentStatus === 'inquiry_resolved') {
    await transitionCycleStatus(
      args.tx,
      args.cycleId,
      args.orgId,
      'ready_to_dispense',
      args.userId,
    );
    await transitionCycleStatus(args.tx, args.cycleId, args.orgId, 'dispensing', args.userId);
    return;
  }

  if (args.currentStatus === 'ready_to_dispense') {
    await transitionCycleStatus(args.tx, args.cycleId, args.orgId, 'dispensing', args.userId);
  }
}

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = createDispenseResultSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { task_id, lines, safety_checklist } = parsed.data;

    const result = await withOrgContext(req.orgId, async (tx) => {
      const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(req);
      // Verify task belongs to this org
      const task = await tx.dispenseTask.findFirst({
        where: {
          id: task_id,
          org_id: req.orgId,
          ...(cycleAssignmentWhere ? { cycle: cycleAssignmentWhere } : {}),
        },
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
              patient_id: true,
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
                  source_type: true,
                  original_collected_at: true,
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
          ]),
      );
      const cycleLevelInquiries = task.cycle.inquiries.filter((item) => item.line_id == null);

      if (cycleLevelInquiries.length > 0) {
        return {
          error: 'cycle_blocked' as const,
          reasons: cycleLevelInquiries.map(
            (item) =>
              `${item.reason}${item.inquiry_to_physician ? ` / ${item.inquiry_to_physician}` : ''}`,
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

      const latestIntake = task.cycle.prescription_intakes[0] ?? null;

      const discrepancyReasonErrors = buildDiscrepancyReasonErrors({
        submittedLines: lines,
        prescribedLines: latestIntake?.lines ?? [],
      });
      if (discrepancyReasonErrors.length > 0) {
        return {
          error: 'reason_required' as const,
          reasons: discrepancyReasonErrors,
        };
      }

      // B5: Line ownership validation — each submitted line_id must belong to the current intake
      const validLineIds = new Set(latestIntake?.lines.map((l) => l.id) ?? []);
      const invalidLines = lines.filter((l) => !validLineIds.has(l.line_id));
      if (invalidLines.length > 0) {
        return {
          error: 'invalid_lines' as const,
          reasons: invalidLines.map((l) => l.line_id),
        };
      }

      const now = new Date();
      const existingResultByLineId = new Map(task.results.map((item) => [item.line_id, item]));
      const latestIntakeLineIds = latestIntake?.lines.map((line) => line.id) ?? [];
      const completedLineIds = new Set([
        ...task.results.map((item) => item.line_id),
        ...lines.map((item) => item.line_id),
      ]);
      const blockedLineIds = new Set(
        task.cycle.inquiries
          .map((item) => item.line_id)
          .filter((lineId): lineId is string => lineId != null),
      );
      const hasRemainingBlockedLine = latestIntakeLineIds.some((lineId) =>
        blockedLineIds.has(lineId),
      );
      const hasAllResults = latestIntakeLineIds.every((lineId) => completedLineIds.has(lineId));
      const canComplete =
        cycleLevelInquiries.length === 0 &&
        !hasRemainingBlockedLine &&
        latestIntakeLineIds.length > 0 &&
        hasAllResults;

      if (!safety_checklist) {
        return { error: 'safety_checklist_required' as const };
      }

      let cdsAlertCounts: ReturnType<typeof countCdsAlertsBySeverity>;
      try {
        const cdsAlerts = await checkDispenseAlerts(
          req.orgId,
          task.cycle_id,
          task.cycle.patient_id,
        );
        cdsAlertCounts = countCdsAlertsBySeverity(cdsAlerts);
      } catch {
        return { error: 'cds_check_unavailable' as const };
      }

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
              }),
        ),
      );

      await tx.dispenseTask.update({
        where: { id: task_id },
        data: { status: canComplete ? 'completed' : 'in_progress' },
      });

      await tx.auditLog.create({
        data: {
          org_id: req.orgId,
          actor_id: req.userId,
          action: 'dispense_safety_checklist_acknowledged',
          target_type: 'dispense_task',
          target_id: task_id,
          changes: {
            task_id,
            cycle_id: task.cycle_id,
            checklist: safety_checklist,
            cds_alert_counts: cdsAlertCounts,
            line_count: results.length,
            partial: !canComplete,
            acknowledged_at: now.toISOString(),
          },
        },
      });

      if (!canComplete) {
        if (task.cycle.overall_status !== 'inquiry_pending') {
          try {
            await promoteCycleToDispensingIfNeeded({
              tx,
              cycleId: task.cycle_id,
              orgId: req.orgId,
              userId: req.userId,
              currentStatus: task.cycle.overall_status,
            });
          } catch (err) {
            if (err instanceof InvalidTransitionError) {
              return {
                error: 'transition_error' as const,
                message: `ステータス遷移が不正です: ${err.fromStatus} → ${err.toStatus}`,
              };
            }
            if (err instanceof VersionConflictError) {
              return { error: 'version_conflict' as const, message: err.message };
            }
            throw err;
          }
        }

        // B3: Create WorkflowException for partial dispense (guard against duplicates)
        const missingLineIds = latestIntakeLineIds.filter(
          (lineId) => !completedLineIds.has(lineId),
        );
        const intakeLines = latestIntake?.lines ?? [];
        const missingLineNames = missingLineIds.map(
          (lineId) => intakeLines.find((l) => l.id === lineId)?.drug_name ?? lineId,
        );
        const existingPartialException = await tx.workflowException.findFirst({
          where: { cycle_id: task.cycle_id, exception_type: 'partial_dispense', status: 'open' },
        });
        if (!existingPartialException) {
          await tx.workflowException.create({
            data: {
              org_id: req.orgId,
              cycle_id: task.cycle_id,
              exception_type: 'partial_dispense',
              severity: 'warning',
              status: 'open',
              description: `部分調剤: 未調剤の行があります (${missingLineNames.join(', ')})`,
            },
          });
        }

        if (latestIntake?.source_type === 'fax' && latestIntake.original_collected_at == null) {
          const dueDate = new Date(now);
          dueDate.setDate(dueDate.getDate() + 3);
          await upsertOperationalTask(tx, {
            orgId: req.orgId,
            taskType: 'fax_original_followup',
            title: 'FAX処方せん原本の回収確認が必要です',
            description: '訪問時回収または後日郵送到着後に原本回収を記録してください',
            priority: 'high',
            dueDate,
            slaDueAt: dueDate,
            dedupeKey: `fax-original-followup:${latestIntake.id}`,
            relatedEntityType: 'prescription_intake',
            relatedEntityId: latestIntake.id,
            metadata: {
              cycle_id: task.cycle_id,
              task_id,
            },
          });
        }

        return { results, task_id, partial: true };
      }

      // B3: Auto-resolve open partial_dispense exceptions when all lines are complete
      await tx.workflowException.updateMany({
        where: { cycle_id: task.cycle_id, exception_type: 'partial_dispense', status: 'open' },
        data: { status: 'resolved', resolved_at: new Date() },
      });

      try {
        await promoteCycleToDispensingIfNeeded({
          tx,
          cycleId: task.cycle_id,
          orgId: req.orgId,
          userId: req.userId,
          currentStatus: task.cycle.overall_status,
        });
        await transitionCycleStatus(tx, task.cycle_id, req.orgId, 'audit_pending', req.userId);
      } catch (err) {
        if (err instanceof InvalidTransitionError) {
          return {
            error: 'transition_error' as const,
            message: `ステータス遷移が不正です: ${err.fromStatus} → ${err.toStatus}`,
          };
        }
        if (err instanceof VersionConflictError) {
          return { error: 'version_conflict' as const, message: err.message };
        }
        throw err;
      }

      const auditRecipients = await tx.membership.findMany({
        where: {
          org_id: req.orgId,
          is_active: true,
          OR: [{ can_audit_dispense: true }, { role: { in: ['owner', 'admin'] as never[] } }],
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

      if (latestIntake?.source_type === 'fax' && latestIntake.original_collected_at == null) {
        const dueDate = new Date(now);
        dueDate.setDate(dueDate.getDate() + 3);
        await upsertOperationalTask(tx, {
          orgId: req.orgId,
          taskType: 'fax_original_followup',
          title: 'FAX処方せん原本の回収確認が必要です',
          description: '訪問時回収または後日郵送到着後に原本回収を記録してください',
          priority: 'high',
          dueDate,
          slaDueAt: dueDate,
          dedupeKey: `fax-original-followup:${latestIntake.id}`,
          relatedEntityType: 'prescription_intake',
          relatedEntityId: latestIntake.id,
          metadata: {
            cycle_id: task.cycle_id,
            task_id,
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
      if (result.error === 'invalid_lines') {
        return validationError('指定された処方明細は現在の処方に属していません', {
          invalid_line_ids: result.reasons,
        });
      }
      if (result.error === 'safety_checklist_required') {
        return validationError(
          '調剤結果の保存には患者・薬剤・数量・用法・保管・安全アラートの確認が必要です',
          {
            safety_checklist: ['required'],
          },
        );
      }
      if (result.error === 'cds_check_unavailable') {
        return validationError(
          '処方安全チェックを完了できません。禁忌・相互作用・アレルギー等を確認できる状態で再試行してください',
          {
            cds_check: ['unavailable'],
          },
        );
      }
      if (result.error === 'transition_error') {
        return validationError(result.message);
      }
      if (result.error === 'version_conflict') {
        return conflict(result.message);
      }
    }

    await notifyWorkflowMutation({
      orgId: req.orgId,
      eventType: 'cycle_transition',
      payload: { source: 'dispense_results', task_id },
    });

    if (!result.partial) {
      await notifyWebhookEventForOrg(req.orgId, 'prescription.dispensed', {
        taskId: result.task_id,
        resultCount: result.results.length,
      });
    }

    return success(result, 201);
  },
  {
    permission: 'canDispense',
    message: '調剤結果の登録権限がありません',
  },
);
