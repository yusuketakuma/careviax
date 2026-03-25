import { prisma } from '@/lib/db';
import { runJob } from './runner';

/**
 * 服用最終日接近チェック（3日以内）
 * 訪問予定の患者の服用最終日が3日以内に迫っている場合、担当薬剤師に通知を作成する
 */
export async function checkMedicationDeadlines() {
  return runJob('medication_deadline_check', async () => {
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

    const approaching = await prisma.visitSchedule.findMany({
      where: {
        medication_end_date: { lte: threeDaysFromNow },
        schedule_status: { in: ['planned', 'in_preparation', 'ready'] },
      },
    });

    for (const schedule of approaching) {
      await prisma.notification.create({
        data: {
          org_id: schedule.org_id,
          user_id: schedule.pharmacist_id,
          type: 'reminder',
          title: '服用最終日接近',
          message: `訪問予定の患者の服用最終日が3日以内です`,
          link: `/visit-schedules/${schedule.id}`,
        },
      });
    }

    return { processedCount: approaching.length };
  });
}

/**
 * リフィル処方箋の次回調剤日通知（7日以内）
 * 次回調剤日が7日以内に迫っているリフィル処方箋を検出する
 */
export async function checkRefillPrescriptions() {
  return runJob('refill_prescription_check', async () => {
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const upcoming = await prisma.prescriptionIntake.findMany({
      where: {
        source_type: 'refill',
        refill_next_dispense_date: { lte: sevenDaysFromNow },
        refill_remaining_count: { gt: 0 },
      },
    });

    return { processedCount: upcoming.length };
  });
}

/**
 * 処方箋有効期限チェック（翌日期限切れ）
 * 翌日に有効期限が切れる処方箋を検出する
 */
export async function checkPrescriptionExpiry() {
  return runJob('prescription_expiry_check', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const expiring = await prisma.prescriptionIntake.findMany({
      where: {
        prescription_expiry_date: { lte: tomorrow },
      },
    });

    return { processedCount: expiring.length };
  });
}
