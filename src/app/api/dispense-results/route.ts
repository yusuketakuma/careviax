import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
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
        cycle: {
          select: {
            id: true,
            visit_schedules: {
              where: {
                schedule_status: { in: ['planned', 'in_preparation', 'ready'] },
              },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
    });

    if (!task) return null;

    const now = new Date();

    // Create DispenseResult records for each line
    const results = await Promise.all(
      lines.map((line) =>
        tx.dispenseResult.create({
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

    // Update DispenseTask status to completed
    await tx.dispenseTask.update({
      where: { id: task_id },
      data: { status: 'completed' },
    });

    // Update MedicationCycle status to audit_pending
    await tx.medicationCycle.update({
      where: { id: task.cycle_id },
      data: { overall_status: 'audit_pending' },
    });

    // Update VisitSchedule.carry_items with dispensed items
    const visitScheduleId = task.cycle.visit_schedules[0]?.id;
    if (visitScheduleId) {
      const carryItems = lines.map((line) => ({
        line_id: line.line_id,
        drug_name: line.actual_drug_name,
        drug_code: line.actual_drug_code,
        quantity: line.actual_quantity,
        unit: line.actual_unit,
        carry_type: line.carry_type,
        special_notes: line.special_notes,
      }));

      await tx.visitSchedule.update({
        where: { id: visitScheduleId },
        data: {
          carry_items: carryItems,
          carry_items_status: 'ready',
        },
      });
    }

    return { results, task_id };
  });

  if (!result) return notFound('指定された調剤タスクが見つかりません');

  return success(result, 201);
}, {
  permission: 'canDispense',
  message: '調剤結果の登録権限がありません',
});
