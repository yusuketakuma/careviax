import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withAuthContext } from '@/lib/auth/context';
import { ADMIN_MEMBER_ROLES, DISPENSE_AUDIT_FALLBACK_MEMBER_ROLES } from '@/lib/auth/member-roles';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError, notFound, conflict } from '@/lib/api/response';
import { formatDateKey } from '@/lib/date-key';
import { prisma } from '@/lib/db/client';
import { isPrismaUniqueConstraintError } from '@/lib/db/prisma-errors';
import { dispatchNotificationEvent } from '@/server/services/notifications';
import { annotateDispenseTask, sortDispenseTasks } from '@/server/services/dispense-task-list';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import {
  transitionCycleStatus,
  InvalidTransitionError,
  VersionConflictError,
} from '@/lib/db/cycle-transition';
import { buildMedicationCycleAssignmentWhere } from '@/server/services/prescription-access';
import { z } from 'zod';
import type { ExceptionSeverity, ExceptionStatus } from '@/types/domain-literals';

export const GET = withAuthContext(
  async (req, ctx) => {
    const now = new Date();
    const { searchParams } = new URL(req.url);
    const badgeOnly = searchParams.get('badge') === '1';
    const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(ctx);

    if (badgeOnly) {
      const tasks = await prisma.dispenseTask.findMany({
        where: {
          org_id: ctx.orgId,
          status: 'completed',
          ...(cycleAssignmentWhere ? { cycle: cycleAssignmentWhere } : {}),
        },
        select: {
          id: true,
          audits: {
            orderBy: { audited_at: 'desc' },
            take: 1,
            select: {
              result: true,
            },
          },
        },
      });
      const count = tasks.filter((task) => {
        const latestAudit = task.audits[0] ?? null;
        return latestAudit == null || latestAudit.result === 'hold';
      }).length;

      return success({ data: { count } });
    }

    const tasks = await prisma.dispenseTask.findMany({
      where: {
        org_id: ctx.orgId,
        status: 'completed',
        ...(cycleAssignmentWhere ? { cycle: cycleAssignmentWhere } : {}),
      },
      orderBy: [{ priority: 'asc' }, { updated_at: 'asc' }],
      include: {
        audits: {
          orderBy: { audited_at: 'desc' },
          take: 1,
          select: {
            id: true,
            result: true,
            audited_at: true,
          },
        },
        results: {
          select: {
            id: true,
            actual_drug_name: true,
            actual_quantity: true,
            actual_unit: true,
            carry_type: true,
            dispensed_at: true,
            line: {
              select: {
                id: true,
                line_number: true,
                drug_name: true,
                drug_code: true,
                dosage_form: true,
                dose: true,
                frequency: true,
                days: true,
                quantity: true,
                unit: true,
                is_generic: true,
                packaging_instructions: true,
                packaging_instruction_tags: true,
                notes: true,
              },
            },
          },
        },
        cycle: {
          select: {
            id: true,
            patient_id: true,
            overall_status: true,
            case_: {
              select: {
                id: true,
                patient: {
                  select: {
                    id: true,
                    name: true,
                    name_kana: true,
                    residences: {
                      where: { is_primary: true },
                      take: 1,
                      select: {
                        building_id: true,
                        address: true,
                      },
                    },
                  },
                },
              },
            },
            prescription_intakes: {
              orderBy: { created_at: 'desc' },
              take: 1,
              select: {
                id: true,
                prescribed_date: true,
                prescriber_name: true,
                prescriber_institution: true,
                original_document_url: true,
                lines: {
                  select: {
                    id: true,
                    line_number: true,
                    drug_name: true,
                    drug_code: true,
                    dosage_form: true,
                    dose: true,
                    frequency: true,
                    days: true,
                    quantity: true,
                    unit: true,
                    is_generic: true,
                    packaging_instructions: true,
                    packaging_instruction_tags: true,
                    notes: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const visible = sortDispenseTasks(tasks, 'updated_at').filter((task) => {
      const latestAudit = task.audits[0] ?? null;
      return latestAudit == null || latestAudit.result === 'hold';
    });

    return success({
      data: visible.map((task) => annotateDispenseTask(task, now)),
    });
  },
  {
    permission: 'canAuditDispense',
    message: '調剤鑑査の閲覧権限がありません',
  },
);

const REJECT_REASON_CODES = [
  'drug_name_mismatch',
  'quantity_error',
  'packaging_error',
  'carry_type_error',
  'labeling_error',
  'other',
] as const;

const createDispenseAuditSchema = z.object({
  task_id: z.string().min(1),
  result: z.enum(['approved', 'rejected', 'hold', 'emergency_approved']),
  reject_reason: z.string().optional(),
  reject_reason_code: z.enum(REJECT_REASON_CODES).optional(),
  reject_detail: z.string().optional(),
  external_audit: z
    .object({
      adapter: z.string().min(1),
      external_id: z.string().min(1),
      image_check_result: z.enum(['pass', 'warning', 'fail']),
      image_check_summary: z.string().optional(),
    })
    .optional(),
  /**
   * 麻薬ダブルカウント(08_audit): 監査者が入力した計数 1 回目 / 2 回目。
   * スキーマ変更を避け、承認/差戻し時に AuditLog(action='dispense_audit_double_count')
   * として記録する(3省2ガイドラインの操作証跡)。
   */
  double_count: z
    .array(
      z.object({
        line_id: z.string().min(1),
        drug_name: z.string().min(1),
        dispensed_quantity: z.number().nullable(),
        first_count: z.number().nullable(),
        second_count: z.number().nullable(),
      }),
    )
    .optional(),
});

function mergeRejectDetail(args: {
  rejectDetail?: string;
  externalAudit?: {
    adapter: string;
    external_id: string;
    image_check_result: 'pass' | 'warning' | 'fail';
    image_check_summary?: string;
  };
}) {
  if (!args.externalAudit) {
    return args.rejectDetail ?? null;
  }

  const externalSummary = [
    `adapter=${args.externalAudit.adapter}`,
    `external_id=${args.externalAudit.external_id}`,
    `image_check=${args.externalAudit.image_check_result}`,
    args.externalAudit.image_check_summary?.trim()
      ? `summary=${args.externalAudit.image_check_summary.trim()}`
      : null,
  ]
    .filter(Boolean)
    .join(' / ');

  return [args.rejectDetail?.trim(), `[external_audit] ${externalSummary}`]
    .filter(Boolean)
    .join('\n');
}

type DispenseAuditMutationError =
  | { error: 'self_audit' }
  | { error: 'already_audited' }
  | { error: string; conflict?: true };

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createDispenseAuditSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const {
      task_id,
      result,
      reject_reason,
      reject_reason_code,
      reject_detail,
      external_audit,
      double_count,
    } = parsed.data;
    const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(ctx);

    if (result === 'rejected' && !reject_reason) {
      return validationError('差戻し時は理由コードが必須です');
    }
    if (result === 'emergency_approved' && !reject_detail?.trim()) {
      return validationError('緊急例外承認時は理由の記録が必須です');
    }

    const auditResult = await withOrgContext(ctx.orgId, async (tx) => {
      const task = await tx.dispenseTask.findFirst({
        where: {
          id: task_id,
          org_id: ctx.orgId,
          ...(cycleAssignmentWhere ? { cycle: cycleAssignmentWhere } : {}),
        },
        select: {
          id: true,
          cycle_id: true,
          assigned_to: true,
          due_date: true,
          priority: true,
          cycle: {
            select: {
              patient_id: true,
              set_plans: {
                select: {
                  id: true,
                },
                take: 1,
              },
              case_: {
                select: {
                  primary_pharmacist_id: true,
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

      // S2: Self-audit prevention — dispenser cannot audit their own work
      const dispensedByUsers = await tx.dispenseResult.findMany({
        where: { task_id, org_id: ctx.orgId },
        select: { dispensed_by: true },
        distinct: ['dispensed_by'],
      });
      const dispenserIds = new Set(dispensedByUsers.map((r) => r.dispensed_by));
      if (dispenserIds.has(ctx.userId)) {
        return { error: 'self_audit' as const };
      }

      // B2: Concurrent audit prevention — reject if a non-hold audit already exists
      const existingAudit = await tx.dispenseAudit.findFirst({
        where: { task_id, result: { notIn: ['hold'] } },
        select: { id: true },
      });
      if (existingAudit) {
        return { error: 'already_audited' as const };
      }

      if (result === 'emergency_approved') {
        const adminMembership = await tx.membership.findFirst({
          where: {
            org_id: ctx.orgId,
            user_id: ctx.userId,
            is_active: true,
            role: { in: [...ADMIN_MEMBER_ROLES] },
          },
          select: {
            id: true,
          },
        });
        if (!adminMembership) {
          return { error: '緊急例外承認は管理者のみ実行できます' } as const;
        }
      }

      const now = new Date();

      // Create DispenseAudit — the partial unique index on (task_id WHERE result NOT IN ('hold'))
      // provides a DB-level TOCTOU guard; catch the constraint violation here.
      const audit = await (async () => {
        try {
          return await tx.dispenseAudit.create({
            data: {
              org_id: ctx.orgId,
              task_id,
              result,
              reject_reason: reject_reason ?? null,
              reject_reason_code: reject_reason_code ?? null,
              reject_detail: mergeRejectDetail({
                rejectDetail: reject_detail,
                externalAudit: external_audit,
              }),
              audited_by: ctx.userId,
              audited_at: now,
            },
          });
        } catch (err) {
          if (isPrismaUniqueConstraintError(err)) {
            return { error: 'already_audited' as const };
          }
          throw err;
        }
      })();
      if ('error' in audit) return audit;

      // 麻薬ダブルカウントの計数値を監査証跡として保存(操作ログ = AuditLog)
      if (double_count && double_count.length > 0) {
        await createAuditLogEntry(tx, ctx, {
          action: 'dispense_audit_double_count',
          targetType: 'DispenseAudit',
          targetId: audit.id,
          changes: { task_id, result, counts: double_count },
        });
      }

      const transitionHelper = async (toStatus: string) => {
        try {
          await transitionCycleStatus(tx, task.cycle_id, ctx.orgId, toStatus, ctx.userId);
        } catch (err) {
          if (err instanceof InvalidTransitionError) {
            return {
              error: `ステータス遷移が不正です: ${err.fromStatus} → ${err.toStatus}`,
            } as const;
          }
          if (err instanceof VersionConflictError) {
            return { error: err.message, conflict: true } as const;
          }
          throw err;
        }
        return null;
      };

      if (result === 'approved' || result === 'emergency_approved') {
        // Two-step transition: audit_pending → audited → setting/visit_ready
        const toAuditedErr = await transitionHelper('audited');
        if (toAuditedErr) return toAuditedErr;
        const nextStatus = task.cycle.set_plans.length > 0 ? 'setting' : 'visit_ready';
        const transitionErr = await transitionHelper(nextStatus);
        if (transitionErr) return transitionErr;
        await tx.dispenseTask.update({
          where: { id: task_id },
          data: { status: 'completed' },
        });

        // B4: Auto-resolve open dispense_audit_rejected exceptions on approval
        await tx.workflowException.updateMany({
          where: {
            cycle_id: task.cycle_id,
            exception_type: 'dispense_audit_rejected',
            status: 'open' satisfies ExceptionStatus,
          },
          data: {
            status: 'resolved' satisfies ExceptionStatus,
            resolved_by: ctx.userId,
            resolved_at: new Date(),
          },
        });
      } else if (result === 'hold') {
        const transitionErr = await transitionHelper('on_hold');
        if (transitionErr) return transitionErr;
      } else if (result === 'rejected') {
        // Update MedicationCycle status back to dispensing for re-dispense
        const transitionErr = await transitionHelper('dispensing');
        if (transitionErr) return transitionErr;
        await tx.dispenseTask.update({
          where: { id: task_id },
          data: { status: 'in_progress' },
        });

        // Auto-create WorkflowException
        await tx.workflowException.create({
          data: {
            org_id: ctx.orgId,
            cycle_id: task.cycle_id,
            patient_id: task.cycle.patient_id,
            exception_type: 'dispense_audit_rejected',
            description: `調剤鑑査差戻し: ${reject_reason ?? '理由未記入'}${reject_detail ? ` — ${reject_detail}` : ''}`,
            severity: 'warning' satisfies ExceptionSeverity,
            status: 'open' satisfies ExceptionStatus,
          },
        });

        const fallbackRecipients = await tx.membership.findMany({
          where: {
            org_id: ctx.orgId,
            is_active: true,
            role: { in: [...DISPENSE_AUDIT_FALLBACK_MEMBER_ROLES] },
            user: {
              is_active: true,
            },
          },
          select: {
            user_id: true,
          },
        });

        const explicitUserIds = Array.from(
          new Set(
            [
              task.assigned_to ?? null,
              task.cycle.case_?.primary_pharmacist_id ?? null,
              ...fallbackRecipients.map((member) => member.user_id),
            ].filter((value): value is string => Boolean(value)),
          ),
        );

        await dispatchNotificationEvent(tx, {
          orgId: ctx.orgId,
          eventType: 'dispense_audit_rejected',
          type: 'urgent',
          title: '調剤鑑査で差戻しが発生しました',
          message: `${task.cycle.case_.patient.name} の調剤結果が差戻しになりました${task.due_date ? `（期限 ${formatDateKey(task.due_date)}）` : ''}`,
          link: `/dispense?taskId=${encodeURIComponent(task.id)}`,
          metadata: {
            task_id,
            cycle_id: task.cycle_id,
            patient_id: task.cycle.patient_id,
            reject_reason: reject_reason ?? null,
            priority: task.priority,
          },
          explicitUserIds,
          dedupeKey: `dispense-audit-rejected:${task_id}:${audit.id}`,
        });
      }

      return audit;
    });

    if (!auditResult) return notFound('指定された調剤タスクが見つかりません');
    if ('error' in auditResult) {
      const auditError = auditResult as DispenseAuditMutationError;
      if (auditError.error === 'self_audit') {
        return validationError('ご自身が調剤した処方の監査はできません');
      }
      if (auditError.error === 'already_audited') {
        return conflict('この調剤タスクは既に監査済みです');
      }
      if ('conflict' in auditError && auditError.conflict) {
        return conflict(auditError.error);
      }
      return validationError(auditError.error);
    }

    await notifyWorkflowMutation({
      orgId: ctx.orgId,
      eventType: 'cycle_transition',
      payload: { source: 'dispense_audits', task_id },
    });

    return success(auditResult, 201);
  },
  {
    permission: 'canAuditDispense',
    message: '調剤鑑査の作成権限がありません',
  },
);
