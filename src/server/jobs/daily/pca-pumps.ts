import { localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { runJob } from '../runner';
import {
  buildPcaPumpReturnInspectionPendingTaskKey,
  buildPcaPumpRentalOverdueTaskKey,
  formatDateKey,
  syncGeneratedOperationalTasks,
  type GeneratedTaskSpec,
} from '../daily-helpers';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import type { JobExecutionContext } from './shared';

export async function checkPcaPumpRentalOverdues(context: JobExecutionContext = {}) {
  return runJob(
    'pca_pump_rental_overdue_check',
    async () => {
      // due_at(@db.Date)は UTC 深夜で保存されるため UTC 深夜の今日で比較する
      const today = utcDateFromLocalKey(localDateKey());
      const overdueRentals = await prisma.pcaPumpRental.findMany({
        where: {
          ...(context.orgId ? { org_id: context.orgId } : {}),
          status: { in: ['scheduled', 'active'] },
          due_at: { lt: today },
        },
        select: {
          id: true,
          org_id: true,
          pump_id: true,
          institution_id: true,
          rented_at: true,
          due_at: true,
          rental_fee_yen: true,
          pump: {
            select: {
              asset_code: true,
              model_name: true,
            },
          },
          institution: {
            select: {
              name: true,
            },
          },
        },
        orderBy: [{ due_at: 'asc' }, { created_at: 'asc' }],
      });

      for (const rental of overdueRentals) {
        await withOrgContext(rental.org_id, async (tx) => {
          await tx.pcaPumpRental.updateMany({
            where: {
              id: rental.id,
              org_id: rental.org_id,
              status: { in: ['scheduled', 'active'] },
              due_at: { lt: today },
            },
            data: {
              status: 'overdue',
            },
          });

          const overdueDays = rental.due_at
            ? Math.max(
                1,
                // due_at は UTC 深夜の @db.Date 値なのでそのまま日数差を取る
                Math.floor((today.getTime() - rental.due_at.getTime()) / 86_400_000),
              )
            : 0;
          const pumpLabel = `${rental.pump.asset_code} ${rental.pump.model_name}`.trim();
          await upsertOperationalTask(tx, {
            orgId: rental.org_id,
            taskType: 'pca_pump_rental_overdue',
            title: 'PCAポンプの返却期限を超過しています',
            description: `${rental.institution.name} への貸出 ${pumpLabel} が返却予定日を${overdueDays}日超過しています。返却予定の確認、延長可否、請求調整を確認してください。`,
            priority: overdueDays >= 7 ? 'urgent' : 'high',
            assignedTo: null,
            dueDate: rental.due_at,
            slaDueAt: rental.due_at,
            relatedEntityType: 'pca_pump_rental',
            relatedEntityId: rental.id,
            dedupeKey: buildPcaPumpRentalOverdueTaskKey(rental.id),
            metadata: {
              rental_id: rental.id,
              pump_id: rental.pump_id,
              pump_asset_code: rental.pump.asset_code,
              institution_id: rental.institution_id,
              institution_name: rental.institution.name,
              rented_at: formatDateKey(rental.rented_at),
              due_at: rental.due_at ? formatDateKey(rental.due_at) : null,
              overdue_days: overdueDays,
              rental_fee_yen: rental.rental_fee_yen,
              action_href: '/admin/pca-pumps',
              action_label: 'PCAポンプ貸出を確認',
            },
          });
        });
      }

      return { processedCount: overdueRentals.length };
    },
    context.orgId,
  );
}

export async function checkPcaPumpReturnInspectionPending(context: JobExecutionContext = {}) {
  return runJob(
    'pca_pump_return_inspection_pending_check',
    async () => {
      // returned_at(@db.Date)との日数差は UTC 深夜の今日を基準に取る
      const today = utcDateFromLocalKey(localDateKey());
      const rentals = await prisma.pcaPumpRental.findMany({
        where: {
          ...(context.orgId ? { org_id: context.orgId } : {}),
          status: 'returned',
          return_inspection_status: 'pending',
        },
        select: {
          id: true,
          org_id: true,
          pump_id: true,
          institution_id: true,
          rented_at: true,
          due_at: true,
          returned_at: true,
          pump: {
            select: {
              asset_code: true,
              model_name: true,
            },
          },
          institution: {
            select: {
              name: true,
            },
          },
        },
        orderBy: [{ returned_at: 'asc' }, { updated_at: 'asc' }],
        take: 200,
      });

      const taskSpecs: GeneratedTaskSpec[] = rentals.map((rental) => {
        // returned_at は UTC 深夜の @db.Date 値なのでそのまま日数差を取る
        const returnedAt = rental.returned_at ?? today;
        const pendingDays = Math.max(
          0,
          Math.floor((today.getTime() - returnedAt.getTime()) / 86_400_000),
        );
        const pumpLabel = `${rental.pump.asset_code} ${rental.pump.model_name}`.trim();
        return {
          orgId: rental.org_id,
          taskType: 'pca_pump_return_inspection_pending',
          title: 'PCAポンプの返却検品が未完了です',
          description: `${rental.institution.name} から返却された ${pumpLabel} の返却検品が未完了です。付属品、清拭、動作確認を完了し、利用可否を確定してください。`,
          priority: pendingDays >= 2 ? 'high' : 'normal',
          assignedTo: null,
          dueDate: rental.returned_at,
          slaDueAt: rental.returned_at,
          relatedEntityType: 'pca_pump_rental',
          relatedEntityId: rental.id,
          dedupeKey: buildPcaPumpReturnInspectionPendingTaskKey(rental.id),
          metadata: {
            rental_id: rental.id,
            pump_id: rental.pump_id,
            pump_asset_code: rental.pump.asset_code,
            institution_id: rental.institution_id,
            institution_name: rental.institution.name,
            rented_at: formatDateKey(rental.rented_at),
            due_at: rental.due_at ? formatDateKey(rental.due_at) : null,
            returned_at: rental.returned_at ? formatDateKey(rental.returned_at) : null,
            pending_days: pendingDays,
            action_href: '/admin/pca-pumps',
            action_label: '返却検品を確認',
          },
        };
      });

      await syncGeneratedOperationalTasks(taskSpecs, ['pca_pump_return_inspection_pending'], {
        scopeOrgIds: context.orgId ? [context.orgId] : undefined,
      });

      return { processedCount: rentals.length };
    },
    context.orgId,
  );
}
