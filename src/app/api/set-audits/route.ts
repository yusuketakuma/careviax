import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { allocateDisplayId } from '@/lib/db/display-id';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, conflict, internalError } from '@/lib/api/response';
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
import { SET_AUDIT_REQUIRED_CHECKLIST_KEYS } from '@/lib/dispensing/set-audit-constants';
import { RejectCode, SetAuditCellState, type ScheduleStatus } from '@prisma/client';
import { logger } from '@/lib/utils/logger';
import type { ExceptionSeverity, ExceptionStatus } from '@/types/domain-literals';
import {
  applyCellAuditPreview,
  buildPersistedSetAuditChecklist,
  buildSetCarryItems,
  cellAuditsAlreadyApplied,
  createSetAuditSchema,
  existingSetAuditMatchesApprovedReplay,
  findInvalidSetAuditPhotoAssetIds,
  findPartialApprovalScopeBlockers,
  findSetAuditApprovalBlockers,
  isIdempotentSetAuditReplay,
  mergeApprovedScope,
  normalizeApprovedScope,
  summarizeCellStates,
  validateCarryPacketEvidence,
} from './route.evidence';

const ROUTE = '/api/set-audits';

const NON_READY_MUTABLE_VISIT_SCHEDULE_STATUSES: ScheduleStatus[] = [
  'planned',
  'in_preparation',
  'postponed',
];

class SetAuditRollback extends Error {
  constructor(
    readonly result:
      | { error: 'cell_version_conflict'; conflict: true }
      | { error: 'already_audited'; conflict: true }
      | { error: string; conflict?: true },
  ) {
    super('set audit transaction rolled back');
  }
}

async function handleGET(req: NextRequest, ctx: AuthContext) {
  return runWithRequestAuthContext(ctx, async () => {
    const { searchParams } = new URL(req.url);
    const planId = searchParams.get('plan_id') ?? undefined;
    const planAssignmentWhere = buildSetPlanAssignmentWhere(ctx);

    // 監査待ち = サイクルが setting 状態のセットプラン。plan_id 指定で単一プランに絞れる。
    const plans = await withOrgContext(
      ctx.orgId,
      (tx) =>
        tx.setPlan.findMany({
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
                    drug_code: true,
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
        }),
      { requestContext: ctx },
    );

    return success({
      data: plans.map((plan) => ({
        ...plan,
        cell_summary: summarizeCellStates(plan.batches),
      })),
    });
  });
}

export const GET = withAuthContext(
  async (req, ctx) => {
    try {
      return await handleGET(req, ctx);
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'set_audits_get_unhandled_error',
          route: ROUTE,
          method: 'GET',
          status: 500,
        },
        err,
      );
      return internalError();
    }
  },
  {
    permission: 'canViewDashboard',
    message: 'セット鑑査の閲覧権限がありません',
  },
);

async function handlePOST(req: NextRequest, ctx: AuthContext) {
  return runWithRequestAuthContext(ctx, async () => {
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
      checklist,
      carry_packet_evidence,
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
      if (!carry_packet_evidence) {
        return validationError('監査OKにはその他薬同梱と訪問持出パケットの確認証跡が必要です');
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

    const auditResult = await withOrgContext(
      ctx.orgId,
      async (tx) => {
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

        // D6: 監査時刻はサーバ信頼時刻に統一 (クライアント audited_at は不採用)。
        const now = new Date();
        const setBatches = await tx.setBatch.findMany({
          where: { plan_id, org_id: ctx.orgId },
          include: {
            line: {
              select: {
                id: true,
                drug_name: true,
                drug_code: true,
                dosage_form: true,
                dose: true,
                frequency: true,
                unit: true,
                route: true,
                packaging_instructions: true,
                packaging_instruction_tags: true,
                notes: true,
              },
            },
          },
        });

        // B3: Zero-batch guard
        if (setBatches.length === 0) {
          return { error: 'no_batches' as const };
        }

        // A setter must never audit a plan that contains their own work. The exception
        // workflow remains unavailable until a distinct approver contract is ratified.
        if (setBatches.some(({ set_by }) => set_by === ctx.userId)) {
          return { error: 'self_audit' as const };
        }

        const carryPacketValidation =
          result === 'approved' && carry_packet_evidence
            ? validateCarryPacketEvidence({
                evidence: carry_packet_evidence,
                planId: plan_id,
                cycleId: plan.cycle_id,
                patientId: plan.cycle?.patient_id ?? null,
                batches: setBatches,
              })
            : null;
        if (carryPacketValidation && !carryPacketValidation.ok) {
          return {
            error: 'invalid_carry_packet_evidence' as const,
            reason: carryPacketValidation.reason,
          };
        }
        const normalizedCarryPacketEvidence =
          carryPacketValidation && carryPacketValidation.ok ? carryPacketValidation.evidence : null;
        const carryPacketEvidenceSummary =
          carryPacketValidation && carryPacketValidation.ok ? carryPacketValidation.summary : null;
        const persistedChecklist = buildPersistedSetAuditChecklist(
          checklist,
          normalizedCarryPacketEvidence,
        );

        const existingTerminalAudit = await tx.setAudit.findFirst({
          where: {
            plan_id,
            org_id: ctx.orgId,
            result: { in: ['approved', 'rejected'] },
            ...(auditAssignmentWhere ? { AND: [auditAssignmentWhere] } : {}),
          },
          orderBy: [{ audited_at: 'desc' }, { created_at: 'desc' }],
          select: {
            id: true,
            result: true,
            approved_scope: true,
            reject_reason: true,
            checklist: true,
            photo_asset_ids: true,
            audited_by: true,
            same_operator_reason: true,
          },
        });
        if (existingTerminalAudit) {
          if (
            result === 'approved' &&
            existingSetAuditMatchesApprovedReplay({
              existingAudit: existingTerminalAudit,
              userId: ctx.userId,
              approvedScope: normalizeApprovedScope(approved_scope),
              checklist: persistedChecklist ? toPrismaJsonInput(persistedChecklist) : undefined,
              photoAssetIds: photo_asset_ids,
              sameOperatorReason: undefined,
            }) &&
            cellAuditsAlreadyApplied(setBatches, cell_audits)
          ) {
            return { ...existingTerminalAudit, idempotent: true } as const;
          }
          return { error: 'already_audited' as const, conflict: true };
        }

        const invalidPhotoAssetIds = await findInvalidSetAuditPhotoAssetIds(tx, {
          orgId: ctx.orgId,
          photoAssetIds: photo_asset_ids,
        });
        if (invalidPhotoAssetIds.length > 0) {
          return {
            error: 'invalid_photo_assets' as const,
            photoAssetIds: invalidPhotoAssetIds,
          };
        }

        // B3: Validate approved_scope keys match actual batches
        if (approved_scope) {
          const validKeys = new Set(setBatches.map((b) => `${b.day_number}-${b.slot}`));
          const invalidKeys = Object.keys(approved_scope).filter((key) => !validKeys.has(key));
          if (invalidKeys.length > 0) {
            return { error: 'invalid_scope_keys' as const, keys: invalidKeys };
          }
        }

        // Validate cell audit references before applying their state transitions.
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

        if (result === 'partial_approved' && effectiveApprovedScope) {
          const partialScope = findPartialApprovalScopeBlockers(
            effectiveSetBatches,
            effectiveApprovedScope,
          );
          if (partialScope.readyCount === 0 || partialScope.blockers.length > 0) {
            return {
              error: 'partial_scope_not_ready' as const,
              blockers: partialScope.blockers.map((batch) => ({
                batch_id: batch.id,
                set_state: batch.set_state,
                audit_state: batch.audit_state,
                ng_code: batch.ng_code ?? null,
              })),
            };
          }
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
              throw new SetAuditRollback({ error: 'cell_version_conflict', conflict: true });
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
            await transitionCycleStatus(
              tx,
              plan.cycle_id,
              ctx.orgId,
              toStatus,
              ctx.userId,
              options,
            );
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
          if (transitionErr) throw new SetAuditRollback(transitionErr);
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
          if (transitionErr) throw new SetAuditRollback(transitionErr);
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

          const reworkTaskDisplayId = await allocateDisplayId(tx, 'Task', ctx.orgId);
          await tx.task.create({
            data: {
              org_id: ctx.orgId,
              display_id: reworkTaskDisplayId,
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
          // rejected — notify + WorkflowException + hold for rework.
          const transitionErr = await transitionHelper('on_hold');
          if (transitionErr) throw new SetAuditRollback(transitionErr);
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
            checklist: persistedChecklist ? toPrismaJsonInput(persistedChecklist) : undefined,
            photo_asset_ids: photo_asset_ids ?? [],
            audited_by: ctx.userId,
            audited_at: now,
            same_operator_reason: null,
            same_operator_approved_by: null,
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
            carry_packet_evidence_summary: carryPacketEvidenceSummary,
            photo_asset_ids: photo_asset_ids ?? [],
          },
        });

        return audit;
      },
      { requestContext: ctx },
    ).catch((err: unknown) => {
      if (err instanceof SetAuditRollback) return err.result;
      throw err;
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
      if (auditResult.error === 'partial_scope_not_ready') {
        return validationError('部分承認範囲に未セットまたは未監査のセルが含まれています', {
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
      if (auditResult.error === 'invalid_carry_packet_evidence') {
        return validationError('その他薬同梱と訪問持出パケットの確認証跡が不正です', {
          reason: 'reason' in auditResult ? auditResult.reason : null,
        });
      }
      if (auditResult.error === 'invalid_photo_assets') {
        return validationError('セット監査写真が見つからないか、監査証跡に利用できません', {
          photo_asset_ids: 'photoAssetIds' in auditResult ? auditResult.photoAssetIds : [],
        });
      }
      if (auditResult.error === 'self_audit') {
        return validationError('ご自身がセットしたセルの監査はできません');
      }
      if (auditResult.error === 'cell_version_conflict') {
        return conflict('セルが他のユーザーによって更新されています。再読み込みしてください');
      }
      if (auditResult.error === 'already_audited') {
        return conflict('このセット監査は既に確定済みです');
      }
      if ('conflict' in auditResult && auditResult.conflict) return conflict(auditResult.error);
      return validationError(auditResult.error ?? 'セット監査に失敗しました');
    }

    if (isIdempotentSetAuditReplay(auditResult)) {
      return success({ data: auditResult });
    }

    await notifyWorkflowMutation({
      orgId: ctx.orgId,
      eventType: 'cycle_transition',
      payload: { source: 'set_audits', plan_id },
    });

    return success({ data: auditResult }, 201);
  });
}

export const POST = withAuthContext(
  async (req, ctx) => {
    try {
      return await handlePOST(req, ctx);
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'set_audits_post_unhandled_error',
          route: ROUTE,
          method: 'POST',
          status: 500,
        },
        err,
      );
      return internalError();
    }
  },
  {
    permission: 'canAuditSet',
    message: 'セット鑑査の実行権限がありません',
  },
);
