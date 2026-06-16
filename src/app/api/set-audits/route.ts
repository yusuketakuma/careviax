import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { success, validationError, notFound, conflict } from '@/lib/api/response';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import {
  transitionCycleStatus,
  InvalidTransitionError,
  VersionConflictError,
} from '@/lib/db/cycle-transition';
import {
  buildSetAuditAssignmentWhere,
  buildSetPlanAssignmentWhere,
} from '@/server/services/prescription-access';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { toPrismaJsonInput } from '@/lib/db/json';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import {
  buildSetBatchHistorySnapshot,
  createSetBatchChangeLog,
} from '@/lib/dispensing/set-batch-history';
import { RejectCode, SetAuditCellState, type ScheduleStatus } from '@prisma/client';
import { z } from 'zod';
import type { ExceptionSeverity, ExceptionStatus } from '@/types/domain-literals';

// 調剤ワークベンチ共通 NG 分類 (RejectCode, 14種)。差戻し/セル NG の理由を構造化する。
const REJECT_CODE_VALUES = Object.values(RejectCode) as [RejectCode, ...RejectCode[]];

// セル単位の監査判定。SetBatch.audit_state を ok/ng に確定する (unaudited は確定対象外)。
const cellAuditSchema = z.object({
  batch_id: z.string().min(1, 'バッチIDは必須です'),
  audit_state: z.enum(['ok', 'ng'], { error: 'セル監査結果を選択してください' }),
  ng_code: z.enum(REJECT_CODE_VALUES).optional(),
  expected_version: z
    .number({ error: 'セルの版番号が不正です' })
    .int('セルの版番号が不正です')
    .nonnegative('セルの版番号が不正です'),
});

// B3: approved_scope keys must match pattern day_number-slot
const approvedScopeSchema = z
  .record(z.string().regex(/^\d+-(?:morning|noon|evening|bedtime|prn)$/), z.boolean())
  .optional();

// p0_15: 6項目チェックリスト(項目キー → 真偽)。3ペイン再構築の右ペインで記録する。
const checklistSchema = z.record(z.string().min(1), z.boolean()).optional();

const createSetAuditSchema = z.object({
  plan_id: z.string().min(1, 'セットプランIDは必須です'),
  result: z.enum(['approved', 'partial_approved', 'rejected'], {
    error: '鑑査結果を選択してください',
  }),
  approved_scope: approvedScopeSchema,
  reject_reason: z.string().optional(),
  // 差戻し/部分承認時の構造化 NG 分類 (RejectCode, 14種)。rejected では必須。
  reject_reason_code: z.enum(REJECT_CODE_VALUES).optional(),
  audited_at: z.string().datetime().optional(),
  // p0_15 セット監査 3ペイン: チェックリストと写真資産(セット前/セット後/設置予定)。
  checklist: checklistSchema,
  photo_asset_ids: z.array(z.string().min(1)).max(50).optional(),
  // 調剤ワークベンチ セル単位監査 (P0): SetBatch.audit_state / ng_code を確定する。
  cell_audits: z.array(cellAuditSchema).max(500).optional(),
});

// 監査OK(approved)に必須の6チェック項目。
// Set-audit API validation checklist. Keep server-side so UI route removal cannot weaken audit validation.
// クライアント側 gate だけでは要求改竄でバイパス可能なので、サーバでも完了を必須にする。
const SET_AUDIT_REQUIRED_CHECKLIST_KEYS = [
  'date_match',
  'timing_match',
  'quantity_match',
  'no_discontinued',
  'residual_usage_ok',
  'cold_storage_separated',
] as const;

const NON_READY_MUTABLE_VISIT_SCHEDULE_STATUSES: ScheduleStatus[] = [
  'planned',
  'in_preparation',
  'postponed',
];

function normalizeApprovedScope(scope: unknown) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    return undefined;
  }

  const normalized = Object.fromEntries(
    Object.entries(scope).filter(([key, value]) => typeof key === 'string' && value === true),
  );

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function mergeApprovedScope(previousScope: unknown, currentScope?: Record<string, boolean>) {
  const previous = normalizeApprovedScope(previousScope) ?? {};
  const current = normalizeApprovedScope(currentScope) ?? {};
  const merged = { ...previous, ...current };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function buildSetCarryItems(
  batches: Array<{
    id: string;
    slot: string;
    day_number: number;
    quantity: number;
    carry_type: string;
    set_state: string;
    audit_state: string;
    line: {
      id: string;
      drug_name: string;
      dose: string;
      frequency: string;
      unit: string | null;
    };
  }>,
  approvedScope?: Record<string, unknown>,
) {
  const approvedKeys =
    approvedScope == null
      ? null
      : new Set(Object.keys(approvedScope).filter((key) => approvedScope[key] === true));

  return batches
    .filter((batch) => {
      if (batch.set_state !== 'set' || batch.audit_state !== 'ok') return false;
      if (!approvedKeys) return true;
      return approvedKeys.has(`${batch.day_number}-${batch.slot}`);
    })
    .map((batch) => ({
      batch_id: batch.id,
      line_id: batch.line.id,
      drug_name: batch.line.drug_name,
      dose: batch.line.dose,
      frequency: batch.line.frequency,
      day_number: batch.day_number,
      slot: batch.slot,
      quantity: batch.quantity,
      unit: batch.line.unit,
      carry_type: batch.carry_type,
    }));
}

function applyCellAuditPreview<
  TBatch extends { id: string; audit_state: string; ng_code?: RejectCode | null },
>(batches: TBatch[], cellAudits: Array<z.infer<typeof cellAuditSchema>> | undefined) {
  if (!cellAudits || cellAudits.length === 0) return batches;
  const auditByBatchId = new Map(cellAudits.map((cell) => [cell.batch_id, cell]));
  return batches.map((batch) => {
    const cell = auditByBatchId.get(batch.id);
    if (!cell) return batch;
    return {
      ...batch,
      audit_state: cell.audit_state,
      ng_code: cell.audit_state === 'ng' ? (cell.ng_code ?? null) : null,
    };
  });
}

function findSetAuditApprovalBlockers(
  batches: Array<{
    id: string;
    set_state: string;
    audit_state: string;
    ng_code?: RejectCode | null;
  }>,
) {
  return batches.filter((batch) => batch.set_state !== 'set' || batch.audit_state !== 'ok');
}

// セル状態の集計 (audit_state 別件数)。監査キュー一覧の進捗表示に使う。
function summarizeCellStates(batches: Array<{ audit_state: SetAuditCellState }>) {
  const summary = { total: batches.length, unaudited: 0, ok: 0, ng: 0 };
  for (const batch of batches) {
    summary[batch.audit_state] += 1;
  }
  return summary;
}

export const GET = withAuthContext(
  async (req: NextRequest, ctx: AuthContext) => {
    const { searchParams } = new URL(req.url);
    const planId = searchParams.get('plan_id') ?? undefined;
    const planAssignmentWhere = buildSetPlanAssignmentWhere(ctx);

    // 監査待ち = サイクルが setting 状態のセットプラン。plan_id 指定で単一プランに絞れる。
    const plans = await prisma.setPlan.findMany({
      where: {
        org_id: ctx.orgId,
        ...(planId ? { id: planId } : {}),
        cycle: { overall_status: 'setting' },
        ...(planAssignmentWhere ? { AND: [planAssignmentWhere] } : {}),
      },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        cycle_id: true,
        target_period_start: true,
        target_period_end: true,
        set_method: true,
        created_at: true,
        updated_at: true,
        cycle: {
          select: {
            id: true,
            overall_status: true,
            patient_id: true,
            case_: {
              select: {
                patient: {
                  select: { id: true, name: true, name_kana: true },
                },
              },
            },
          },
        },
        batches: {
          orderBy: [{ day_number: 'asc' }, { slot: 'asc' }],
          select: {
            id: true,
            slot: true,
            day_number: true,
            quantity: true,
            carry_type: true,
            set_state: true,
            audit_state: true,
            ng_code: true,
            set_by: true,
            audited_by: true,
            audited_at: true,
            version: true,
            line: {
              select: {
                id: true,
                drug_name: true,
                dose: true,
                frequency: true,
                unit: true,
              },
            },
          },
        },
        audits: {
          orderBy: [{ audited_at: 'desc' }, { created_at: 'desc' }],
          take: 1,
          select: {
            id: true,
            result: true,
            reject_reason: true,
            audited_at: true,
            audited_by: true,
          },
        },
      },
    });

    return success({
      data: plans.map((plan) => ({
        ...plan,
        cell_summary: summarizeCellStates(plan.batches),
      })),
    });
  },
  {
    permission: 'canAuditSet',
    message: 'セット鑑査の閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req: NextRequest, ctx: AuthContext) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createSetAuditSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const {
      plan_id,
      result,
      approved_scope,
      reject_reason,
      reject_reason_code,
      audited_at,
      checklist,
      photo_asset_ids,
      cell_audits,
    } = parsed.data;

    // 監査OKはサーバ側でも現行3ペインUIの全6項目チェック完了を必須にする。
    if (result === 'approved') {
      const allChecked = SET_AUDIT_REQUIRED_CHECKLIST_KEYS.every(
        (key) => checklist?.[key] === true,
      );
      if (!allChecked) {
        return validationError('監査OKには全6項目のチェックが必要です');
      }
    }

    // 差戻し時は構造化 NG 分類 (RejectCode) を必須にする (§12-5 監査証跡)。
    // 自由記述 reject_reason だけでは集計/分析できないため、コード化を強制する。
    if (result === 'rejected' && !reject_reason_code) {
      return validationError('差戻し時はNG分類コード(reject_reason_code)が必須です');
    }

    // セル監査: NG セルには必ず NG 分類コードを添付する。重複バッチ指定も拒否する。
    if (cell_audits && cell_audits.length > 0) {
      const seen = new Set<string>();
      for (const cell of cell_audits) {
        if (seen.has(cell.batch_id)) {
          return validationError('セル監査のバッチIDが重複しています', {
            batch_id: cell.batch_id,
          });
        }
        seen.add(cell.batch_id);
        if (cell.audit_state === 'ng' && !cell.ng_code) {
          return validationError('NGセルにはNG分類コード(ng_code)が必須です', {
            batch_id: cell.batch_id,
          });
        }
      }
    }

    const auditResult = await withOrgContext(ctx.orgId, async (tx) => {
      const planAssignmentWhere = buildSetPlanAssignmentWhere(ctx);
      const auditAssignmentWhere = buildSetAuditAssignmentWhere(ctx);
      const plan = await tx.setPlan.findFirst({
        where: {
          id: plan_id,
          org_id: ctx.orgId,
          ...(planAssignmentWhere ? { AND: [planAssignmentWhere] } : {}),
        },
        select: {
          id: true,
          cycle_id: true,
          cycle: {
            select: {
              patient_id: true,
            },
          },
        },
      });

      if (!plan) return null;

      const now = audited_at ? new Date(audited_at) : new Date();
      const setBatches = await tx.setBatch.findMany({
        where: { plan_id, org_id: ctx.orgId },
        include: {
          line: {
            select: {
              id: true,
              drug_name: true,
              dose: true,
              frequency: true,
              unit: true,
            },
          },
        },
      });

      // B3: Zero-batch guard
      if (setBatches.length === 0) {
        return { error: 'no_batches' as const };
      }

      // B3: Validate approved_scope keys match actual batches
      if (approved_scope) {
        const validKeys = new Set(setBatches.map((b) => `${b.day_number}-${b.slot}`));
        const invalidKeys = Object.keys(approved_scope).filter((key) => !validKeys.has(key));
        if (invalidKeys.length > 0) {
          return { error: 'invalid_scope_keys' as const, keys: invalidKeys };
        }
      }

      // セル単位監査の事前検証 (職務分離 + バッチ所属確認)。
      // 確定 (SetBatch.audit_state/ng_code 更新) は監査記録作成後にまとめて行う。
      if (cell_audits && cell_audits.length > 0) {
        const batchById = new Map(setBatches.map((batch) => [batch.id, batch]));

        for (const cell of cell_audits) {
          const batch = batchById.get(cell.batch_id);
          // 指定バッチが当該プランに属さない → 不正リクエスト。
          if (!batch) {
            return { error: 'invalid_batch' as const, batchId: cell.batch_id };
          }
          // The auditor must confirm the same SetBatch version they saw in the calendar UI.
          if (cell.expected_version !== batch.version) {
            return { error: 'cell_version_conflict' as const, conflict: true };
          }
          // 職務分離 (§12-5): セット実施者は自身がセットしたセルを監査できない。
          if (batch.set_by && batch.set_by === ctx.userId) {
            return { error: 'self_audit' as const };
          }
        }
      }

      const effectiveSetBatches = applyCellAuditPreview(setBatches, cell_audits);

      const latestAudit =
        result === 'partial_approved'
          ? await tx.setAudit.findFirst({
              where: {
                plan_id,
                org_id: ctx.orgId,
                ...(auditAssignmentWhere ? { AND: [auditAssignmentWhere] } : {}),
              },
              orderBy: [{ audited_at: 'desc' }, { created_at: 'desc' }],
              select: {
                result: true,
                approved_scope: true,
              },
            })
          : null;

      const effectiveApprovedScope =
        result === 'partial_approved'
          ? latestAudit?.result === 'partial_approved'
            ? mergeApprovedScope(latestAudit.approved_scope, approved_scope)
            : normalizeApprovedScope(approved_scope)
          : normalizeApprovedScope(approved_scope);

      if (result === 'partial_approved' && !effectiveApprovedScope) {
        return { error: 'missing_scope' as const };
      }

      if (result === 'approved') {
        const approvalBlockers = findSetAuditApprovalBlockers(effectiveSetBatches);
        if (approvalBlockers.length > 0) {
          return {
            error: 'approval_not_ready' as const,
            blockers: approvalBlockers.map((batch) => ({
              batch_id: batch.id,
              set_state: batch.set_state,
              audit_state: batch.audit_state,
              ng_code: batch.ng_code ?? null,
            })),
          };
        }
      }

      // セル単位監査の確定: SetBatch.audit_state / ng_code を先に OCC 更新する。
      // ここで競合した場合は cycle / visit / SetAudit に触らず 409 を返す。
      if (cell_audits && cell_audits.length > 0) {
        const batchById = new Map(setBatches.map((batch) => [batch.id, batch]));

        for (const cell of cell_audits) {
          const before = batchById.get(cell.batch_id);
          if (!before) continue; // 事前検証済み: 通常到達しない。
          const ngCode = cell.audit_state === 'ng' ? (cell.ng_code as RejectCode) : null;

          const updateResult = await tx.setBatch.updateMany({
            where: { id: cell.batch_id, org_id: ctx.orgId, version: before.version },
            data: {
              audit_state: cell.audit_state satisfies SetAuditCellState,
              ng_code: ngCode,
              audited_by: ctx.userId,
              audited_at: now,
              version: { increment: 1 },
            },
          });
          if (updateResult.count === 0) {
            return { error: 'cell_version_conflict' as const, conflict: true };
          }

          const after = {
            ...before,
            audit_state: cell.audit_state satisfies SetAuditCellState,
            ng_code: ngCode,
            audited_by: ctx.userId,
            audited_at: now,
            version: before.version + 1,
          };

          await createSetBatchChangeLog(tx, {
            orgId: ctx.orgId,
            planId: plan_id,
            batchId: cell.batch_id,
            action: 'cell_audit',
            triggerSource: 'set_audit',
            reason: ngCode ? `セルNG: ${ngCode}` : 'セルOK',
            lineIds: [before.line_id],
            beforeSnapshot: [buildSetBatchHistorySnapshot(before)],
            afterSnapshot: [buildSetBatchHistorySnapshot(after)],
            changedBy: ctx.userId,
          });

          await createAuditLogEntry(tx, ctx, {
            action: 'set_audit.cell',
            targetType: 'set_batch',
            targetId: cell.batch_id,
            changes: {
              plan_id,
              cycle_id: plan.cycle_id,
              line_id: before.line_id,
              day_number: before.day_number,
              slot: before.slot,
              audit_state: cell.audit_state,
              ng_code: ngCode,
            },
          });
        }
      }

      const transitionHelper = async (
        toStatus: string,
        options?: { exceptionStatus?: string | null },
      ) => {
        try {
          await transitionCycleStatus(tx, plan.cycle_id, ctx.orgId, toStatus, ctx.userId, options);
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

      if (result === 'approved') {
        // carry_items confirmed — advance cycle to set_audited
        const carryItems = buildSetCarryItems(effectiveSetBatches);
        const carryItemsInput = toPrismaJsonInput(carryItems);
        const transitionErr = await transitionHelper('set_audited');
        if (transitionErr) return transitionErr;
        await tx.visitSchedule.updateMany({
          where: {
            org_id: ctx.orgId,
            cycle_id: plan.cycle_id,
            schedule_status: {
              in: NON_READY_MUTABLE_VISIT_SCHEDULE_STATUSES,
            },
          },
          data: {
            carry_items: carryItemsInput,
            carry_items_status: 'ready',
          },
        });
        await tx.visitPreparation.updateMany({
          where: {
            org_id: ctx.orgId,
            schedule: {
              org_id: ctx.orgId,
              cycle_id: plan.cycle_id,
              schedule_status: 'ready',
            },
          },
          data: {
            carry_items_confirmed: false,
            prepared_at: null,
          },
        });
        await tx.visitSchedule.updateMany({
          where: {
            org_id: ctx.orgId,
            cycle_id: plan.cycle_id,
            schedule_status: 'ready',
          },
          data: {
            carry_items: carryItemsInput,
            carry_items_status: 'ready',
            schedule_status: 'in_preparation',
            pre_visit_checklist_completed: false,
          },
        });

        // B4: Auto-resolve open set_audit_rejected exceptions on approval
        await tx.workflowException.updateMany({
          where: {
            cycle_id: plan.cycle_id,
            exception_type: 'set_audit_rejected',
            status: 'open' satisfies ExceptionStatus,
          },
          data: {
            status: 'resolved' satisfies ExceptionStatus,
            resolved_by: ctx.userId,
            resolved_at: new Date(),
          },
        });
      } else if (result === 'partial_approved') {
        // Partial: carry_items_partial + re-work task
        const carryItems = buildSetCarryItems(effectiveSetBatches, effectiveApprovedScope);
        const carryItemsInput = toPrismaJsonInput(carryItems);
        const transitionErr = await transitionHelper('set_audited', {
          exceptionStatus: 'carry_items_partial',
        });
        if (transitionErr) return transitionErr;
        await tx.visitSchedule.updateMany({
          where: {
            org_id: ctx.orgId,
            cycle_id: plan.cycle_id,
            schedule_status: {
              in: NON_READY_MUTABLE_VISIT_SCHEDULE_STATUSES,
            },
          },
          data: {
            carry_items: carryItemsInput,
            carry_items_status: 'partial',
          },
        });
        await tx.visitPreparation.updateMany({
          where: {
            org_id: ctx.orgId,
            schedule: {
              org_id: ctx.orgId,
              cycle_id: plan.cycle_id,
              schedule_status: 'ready',
            },
          },
          data: {
            carry_items_confirmed: false,
            prepared_at: null,
          },
        });
        await tx.visitSchedule.updateMany({
          where: {
            org_id: ctx.orgId,
            cycle_id: plan.cycle_id,
            schedule_status: 'ready',
          },
          data: {
            carry_items: carryItemsInput,
            carry_items_status: 'partial',
            schedule_status: 'in_preparation',
            pre_visit_checklist_completed: false,
          },
        });

        await tx.task.create({
          data: {
            org_id: ctx.orgId,
            title: 'セット再作業（部分承認）',
            description: `セット鑑査で部分承認となりました。承認範囲: ${
              effectiveApprovedScope ? JSON.stringify(effectiveApprovedScope) : '未指定'
            }`,
            status: 'pending',
            priority: 'high',
            related_entity_type: 'cycle',
            related_entity_id: plan.cycle_id,
          },
        });
      } else {
        // rejected — notify + WorkflowException + back to setting
        const transitionErr = await transitionHelper('setting');
        if (transitionErr) return transitionErr;
        await tx.visitSchedule.updateMany({
          where: {
            org_id: ctx.orgId,
            cycle_id: plan.cycle_id,
            schedule_status: {
              in: NON_READY_MUTABLE_VISIT_SCHEDULE_STATUSES,
            },
          },
          data: {
            carry_items: [],
            carry_items_status: 'blocked',
          },
        });
        await tx.visitPreparation.updateMany({
          where: {
            org_id: ctx.orgId,
            schedule: {
              org_id: ctx.orgId,
              cycle_id: plan.cycle_id,
              schedule_status: 'ready',
            },
          },
          data: {
            carry_items_confirmed: false,
            prepared_at: null,
          },
        });
        await tx.visitSchedule.updateMany({
          where: {
            org_id: ctx.orgId,
            cycle_id: plan.cycle_id,
            schedule_status: 'ready',
          },
          data: {
            carry_items: [],
            carry_items_status: 'blocked',
            schedule_status: 'in_preparation',
            pre_visit_checklist_completed: false,
          },
        });

        await tx.workflowException.create({
          data: {
            org_id: ctx.orgId,
            cycle_id: plan.cycle_id,
            patient_id: plan.cycle?.patient_id ?? null,
            exception_type: 'set_audit_rejected',
            description: `セット鑑査差戻し: ${reject_reason ?? '理由未記入'}`,
            severity: 'warning' satisfies ExceptionSeverity,
            status: 'open' satisfies ExceptionStatus,
          },
        });
      }

      const audit = await tx.setAudit.create({
        data: {
          org_id: ctx.orgId,
          plan_id,
          result,
          approved_scope: effectiveApprovedScope
            ? toPrismaJsonInput(effectiveApprovedScope)
            : undefined,
          reject_reason: reject_reason ?? null,
          checklist: checklist ? toPrismaJsonInput(checklist) : undefined,
          photo_asset_ids: photo_asset_ids ?? [],
          audited_by: ctx.userId,
          audited_at: now,
        },
      });

      // 監査ログ(audit-by-default): セット鑑査の判定・チェックリスト・写真資産を記録。
      await createAuditLogEntry(tx, ctx, {
        action: 'set_audit.create',
        targetType: 'set_audit',
        targetId: audit.id,
        changes: {
          plan_id,
          cycle_id: plan.cycle_id,
          result,
          reject_reason: reject_reason ?? null,
          reject_reason_code: reject_reason_code ?? null,
          checklist: checklist ?? null,
          photo_asset_ids: photo_asset_ids ?? [],
        },
      });

      return audit;
    });

    if (!auditResult) return notFound('指定されたセットプランが見つかりません');
    if ('error' in auditResult) {
      if (auditResult.error === 'no_batches') {
        return validationError('セットバッチが存在しないプランは鑑査できません');
      }
      if (auditResult.error === 'missing_scope') {
        return validationError('部分承認時は承認済みスロットを1件以上指定してください');
      }
      if (auditResult.error === 'approval_not_ready') {
        return validationError('未セットまたは未監査のセルがあるため監査OKにはできません', {
          blockers: 'blockers' in auditResult ? auditResult.blockers : [],
        });
      }
      if (auditResult.error === 'invalid_scope_keys') {
        return validationError('承認範囲のキーが実際のバッチと一致しません', {
          invalid_keys: 'keys' in auditResult ? auditResult.keys : [],
        });
      }
      if (auditResult.error === 'invalid_batch') {
        return validationError('指定されたセルが当該プランに存在しません', {
          batch_id: 'batchId' in auditResult ? auditResult.batchId : null,
        });
      }
      if (auditResult.error === 'self_audit') {
        return validationError('ご自身がセットしたセルの監査はできません');
      }
      if (auditResult.error === 'cell_version_conflict') {
        return conflict('セルが他のユーザーによって更新されています。再読み込みしてください');
      }
      if ('conflict' in auditResult && auditResult.conflict) return conflict(auditResult.error);
      return validationError(auditResult.error);
    }

    await notifyWorkflowMutation({
      orgId: ctx.orgId,
      eventType: 'cycle_transition',
      payload: { source: 'set_audits', plan_id },
    });

    return success({ data: auditResult }, 201);
  },
  {
    permission: 'canAuditSet',
    message: 'セット鑑査の実行権限がありません',
  },
);
