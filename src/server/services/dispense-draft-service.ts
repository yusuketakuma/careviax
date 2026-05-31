/**
 * 調剤ドラフト生成サービス
 *
 * 処方登録完了後に呼ばれ、薬剤師向けの調剤ドラフト（DispenseTask）を自動生成する。
 * ドラフトの中身（prefill）は compute-on-GET で prefill-generator が担当。
 *
 * 責務:
 * - DispenseTask 作成（pending → dispensing 遷移）
 * - MedicationCycle の dispensing ステータスへの遷移
 * - 疑義照会がある場合は inquiry_pending で一時停止
 *
 * 呼び出し元: prescription-intake-service.ts（処方登録完了時）
 */

import type { Prisma } from '@prisma/client';
import { transitionCycleStatus } from '@/lib/db/cycle-transition';

type UpdatedCycle = {
  id: string;
  patient_id: string;
  case_id: string | null;
};
type DispenseDraftTx = {
  cycleTransitionLog: Pick<Prisma.TransactionClient['cycleTransitionLog'], 'create'>;
  dispenseTask: Pick<Prisma.TransactionClient['dispenseTask'], 'create' | 'findFirst'>;
  medicationCycle: Pick<Prisma.TransactionClient['medicationCycle'], 'findFirst' | 'updateMany'>;
};

async function readCycleSummary(
  tx: DispenseDraftTx,
  args: { orgId: string; cycleId: string }
): Promise<UpdatedCycle> {
  const cycle = await tx.medicationCycle.findFirst({
    where: { id: args.cycleId, org_id: args.orgId },
    select: { id: true, patient_id: true, case_id: true },
  });
  if (!cycle) {
    throw new Error(`MedicationCycle not found: ${args.cycleId}`);
  }
  return cycle;
}

/**
 * 処方登録完了後に調剤ドラフト（DispenseTask）を生成し、
 * MedicationCycle を適切なステータスに遷移させる。
 *
 * - 疑義照会がある場合: inquiry_pending で一時停止
 * - 疑義照会がない場合: ready_to_dispense → dispensing に遷移 + DispenseTask 作成
 */
export async function createDispenseDraft(
  tx: DispenseDraftTx,
  args: {
    orgId: string;
    userId: string;
    cycleId: string;
    currentStatus: string;
    primaryPharmacistId: string | null;
    shouldPauseForInquiry: boolean;
    taskPriority?: 'emergency' | 'urgent' | 'normal';
  }
): Promise<UpdatedCycle> {
  if (args.shouldPauseForInquiry) {
    if (args.currentStatus === 'intake_received' || args.currentStatus === 'structuring') {
      await transitionCycleStatus(tx, args.cycleId, args.orgId, 'inquiry_pending', args.userId);
      return readCycleSummary(tx, { orgId: args.orgId, cycleId: args.cycleId });
    }

    await transitionCycleStatus(tx, args.cycleId, args.orgId, 'inquiry_pending', args.userId);
    return readCycleSummary(tx, { orgId: args.orgId, cycleId: args.cycleId });
  }

  let currentStatus = args.currentStatus;

  if (currentStatus === 'intake_received') {
    await transitionCycleStatus(tx, args.cycleId, args.orgId, 'structuring', args.userId);
    currentStatus = 'structuring';
  }

  if (currentStatus === 'structuring' || currentStatus === 'inquiry_resolved') {
    await transitionCycleStatus(tx, args.cycleId, args.orgId, 'ready_to_dispense', args.userId);
    currentStatus = 'ready_to_dispense';
  }

  if (currentStatus === 'ready_to_dispense') {
    const existingDispenseTask =
      typeof tx.dispenseTask?.findFirst === 'function'
        ? await tx.dispenseTask.findFirst({
            where: {
              org_id: args.orgId,
              cycle_id: args.cycleId,
              status: {
                in: ['pending', 'in_progress'],
              },
            },
            select: { id: true },
          })
        : null;

    if (!existingDispenseTask && typeof tx.dispenseTask?.create === 'function') {
      await tx.dispenseTask.create({
        data: {
          org_id: args.orgId,
          cycle_id: args.cycleId,
          assigned_to: args.primaryPharmacistId,
          priority: args.taskPriority ?? 'normal',
          status: 'pending',
        },
      });
    }

    await transitionCycleStatus(tx, args.cycleId, args.orgId, 'dispensing', args.userId);
    return readCycleSummary(tx, { orgId: args.orgId, cycleId: args.cycleId });
  }

  return readCycleSummary(tx, { orgId: args.orgId, cycleId: args.cycleId });
}
