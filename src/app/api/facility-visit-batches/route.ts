import { z } from 'zod';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { deriveFacilityLabel } from '@/lib/utils/facility';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';

const upsertFacilityVisitBatchSchema = z
  .object({
    schedule_ids: z.array(z.string().trim().min(1)).optional(),
    facility_id: z.string().trim().optional(),
    scheduled_date: z.string().date().optional(),
    pharmacist_id: z.string().trim().optional(),
    site_id: z.string().trim().optional(),
    ordered_schedule_ids: z.array(z.string().trim().min(1)).optional(),
    carry_items_confirmed: z.boolean().optional(),
    allow_mixed_unit: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.schedule_ids?.length) {
      if (value.schedule_ids.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['schedule_ids'],
          message: '2件以上の訪問予定が必要です',
        });
      }
      return;
    }

    if (!value.facility_id || !value.scheduled_date || !value.pharmacist_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['facility_id'],
        message:
          'schedule_ids もしくは facility_id / scheduled_date / pharmacist_id を指定してください',
      });
    }
  });

function buildFacilityLabel(schedule: {
  case_: {
    patient: {
      residences: Array<{
        facility_id: string | null;
        building_id: string | null;
        address: string;
        unit_name: string | null;
      }>;
    };
  };
}) {
  const residence = schedule.case_.patient.residences[0] ?? null;
  return deriveFacilityLabel(residence);
}

function compareUnitName(
  left: { case_: { patient: { residences: Array<{ unit_name: string | null }> } } },
  right: { case_: { patient: { residences: Array<{ unit_name: string | null }> } } }
) {
  const leftUnit = left.case_.patient.residences[0]?.unit_name ?? '';
  const rightUnit = right.case_.patient.residences[0]?.unit_name ?? '';
  if (!leftUnit && !rightUnit) return 0;
  if (!leftUnit) return 1;
  if (!rightUnit) return -1;
  return leftUnit.localeCompare(rightUnit, 'ja', { numeric: true, sensitivity: 'base' });
}

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = upsertFacilityVisitBatchSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const requestedIds = Array.from(new Set(parsed.data.schedule_ids ?? []));
    const orderedIds =
      parsed.data.ordered_schedule_ids != null
        ? Array.from(new Set(parsed.data.ordered_schedule_ids))
        : null;
    if (orderedIds && requestedIds.length > 0 && orderedIds.length !== requestedIds.length) {
      return validationError('順序指定と対象予定数が一致しません');
    }
    if (orderedIds && requestedIds.some((scheduleId) => !orderedIds.includes(scheduleId))) {
      return validationError('順序指定に対象外の訪問予定が含まれています');
    }

    const result = await withOrgContext(req.orgId, async (tx) => {
      const schedules = await tx.visitSchedule.findMany({
        where: {
          org_id: req.orgId,
          ...(requestedIds.length > 0
            ? {
                id: {
                  in: requestedIds,
                },
              }
            : {
                scheduled_date: new Date(parsed.data.scheduled_date!),
                pharmacist_id: parsed.data.pharmacist_id,
                ...(parsed.data.site_id ? { site_id: parsed.data.site_id } : {}),
                case_: {
                  patient: {
                    residences: {
                      some: {
                        is_primary: true,
                        facility_id: parsed.data.facility_id,
                      },
                    },
                  },
                },
              }),
        },
        select: {
          id: true,
          site_id: true,
          pharmacist_id: true,
          scheduled_date: true,
          facility_batch_id: true,
          case_id: true,
          preparation: {
            select: {
              id: true,
              checklist: true,
              medication_changes_reviewed: true,
              carry_items_confirmed: true,
              previous_issues_reviewed: true,
              route_confirmed: true,
              offline_synced: true,
              prepared_at: true,
            },
          },
          case_: {
            select: {
              patient: {
                select: {
                  id: true,
                  name: true,
                  residences: {
                    where: { is_primary: true },
                    take: 1,
                    select: {
                      facility_id: true,
                      facility_unit_id: true,
                      address: true,
                      building_id: true,
                      unit_name: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (requestedIds.length > 0 && schedules.length !== requestedIds.length) {
        return { error: 'missing_schedule' as const };
      }
      if (schedules.length < 2) {
        return { error: 'not_enough_schedules' as const };
      }

      const targetScheduleIds =
        requestedIds.length > 0 ? requestedIds : schedules.map((schedule) => schedule.id);
      if (orderedIds && orderedIds.length !== targetScheduleIds.length) {
        return { error: 'ordered_length_mismatch' as const };
      }
      if (
        orderedIds &&
        targetScheduleIds.some((scheduleId) => !orderedIds.includes(scheduleId))
      ) {
        return { error: 'ordered_contains_unknown' as const };
      }

      const siteIds = new Set(schedules.map((schedule) => schedule.site_id ?? 'site:none'));
      const pharmacistIds = new Set(schedules.map((schedule) => schedule.pharmacist_id));
      const dateKeys = new Set(
        schedules.map((schedule) => schedule.scheduled_date.toISOString().slice(0, 10))
      );
      const facilityLabels = new Set(
        schedules
          .map((schedule) => buildFacilityLabel(schedule))
          .filter((value): value is string => value != null)
      );
      if (siteIds.size > 1 || pharmacistIds.size > 1 || dateKeys.size > 1) {
        return { error: 'mixed_schedule_scope' as const };
      }
      if (facilityLabels.size !== 1) {
        return {
          error: 'mixed_facility' as const,
          facilities: Array.from(facilityLabels),
        };
      }

      const facilityUnitIdSet = new Set(
        schedules
          .map(
            (schedule) => schedule.case_.patient.residences[0]?.facility_unit_id ?? 'unit:none'
          )
      );
      if (facilityUnitIdSet.size > 1 && !parsed.data.allow_mixed_unit) {
        return { error: 'mixed_facility_unit' as const };
      }

      const rawFacilityUnitId = Array.from(facilityUnitIdSet)[0] ?? 'unit:none';
      const facilityUnitId = rawFacilityUnitId === 'unit:none' ? null : rawFacilityUnitId;

      const existingBatchIds = Array.from(
        new Set(
          schedules
            .map((schedule) => schedule.facility_batch_id)
            .filter((value): value is string => value != null)
        )
      );
      if (existingBatchIds.length > 1) {
        return { error: 'mixed_existing_batch' as const };
      }

      const scheduleById = new Map(schedules.map((schedule) => [schedule.id, schedule]));
      const orderedSchedules = (
        orderedIds ?? schedules.slice().sort(compareUnitName).map((schedule) => schedule.id)
      )
        .map((scheduleId) => scheduleById.get(scheduleId))
        .filter((schedule): schedule is NonNullable<typeof schedule> => schedule != null);

      const batch =
        existingBatchIds.length === 1
          ? await tx.facilityVisitBatch.update({
              where: { id: existingBatchIds[0] },
              data: {
                facility_id: Array.from(facilityLabels)[0],
                facility_unit_id: facilityUnitId,
                scheduled_date: schedules[0].scheduled_date,
                pharmacist_id: schedules[0].pharmacist_id,
                patient_ids: orderedSchedules.map((schedule) => schedule.case_.patient.id),
              },
            })
          : await tx.facilityVisitBatch.create({
              data: {
                org_id: req.orgId,
                facility_id: Array.from(facilityLabels)[0],
                facility_unit_id: facilityUnitId,
                scheduled_date: schedules[0].scheduled_date,
                pharmacist_id: schedules[0].pharmacist_id,
                patient_ids: orderedSchedules.map((schedule) => schedule.case_.patient.id),
              },
            });

      await Promise.all(
        orderedSchedules.map((schedule, index) =>
          tx.visitSchedule.update({
            where: { id: schedule.id },
            data: {
              facility_batch_id: batch.id,
              route_order: index + 1,
            },
          })
        )
      );

      if (parsed.data.carry_items_confirmed) {
        await Promise.all(
          orderedSchedules.map((schedule) => {
            const currentPreparation = schedule.preparation;
            const allChecklistComplete =
              (currentPreparation?.medication_changes_reviewed ?? false) &&
              true &&
              (currentPreparation?.previous_issues_reviewed ?? false) &&
              (currentPreparation?.route_confirmed ?? false) &&
              (currentPreparation?.offline_synced ?? false);

            return tx.visitPreparation.upsert({
              where: { schedule_id: schedule.id },
              create: {
                org_id: req.orgId,
                schedule_id: schedule.id,
                checklist: currentPreparation?.checklist ?? {},
                medication_changes_reviewed:
                  currentPreparation?.medication_changes_reviewed ?? false,
                carry_items_confirmed: true,
                previous_issues_reviewed:
                  currentPreparation?.previous_issues_reviewed ?? false,
                route_confirmed: currentPreparation?.route_confirmed ?? false,
                offline_synced: currentPreparation?.offline_synced ?? false,
                prepared_by: req.userId,
                prepared_at: allChecklistComplete ? new Date() : null,
              },
              update: {
                checklist: currentPreparation?.checklist ?? {},
                medication_changes_reviewed:
                  currentPreparation?.medication_changes_reviewed ?? false,
                carry_items_confirmed: true,
                previous_issues_reviewed:
                  currentPreparation?.previous_issues_reviewed ?? false,
                route_confirmed: currentPreparation?.route_confirmed ?? false,
                offline_synced: currentPreparation?.offline_synced ?? false,
                prepared_by: req.userId,
                prepared_at: allChecklistComplete
                  ? currentPreparation?.prepared_at ?? new Date()
                  : null,
              },
            });
          })
        );
      }

      return {
        batch_id: batch.id,
        facility_label: Array.from(facilityLabels)[0],
        patient_count: orderedSchedules.length,
        carry_items_confirmed: Boolean(parsed.data.carry_items_confirmed),
        schedules: orderedSchedules.map((schedule, index) => ({
          schedule_id: schedule.id,
          case_id: schedule.case_id,
          patient_id: schedule.case_.patient.id,
          patient_name: schedule.case_.patient.name,
          unit_name: schedule.case_.patient.residences[0]?.unit_name ?? null,
          route_order: index + 1,
        })),
      };
    });

    if ('error' in result) {
      if (result.error === 'missing_schedule') {
        return validationError('施設一括訪問に含まれる訪問予定が見つかりません');
      }
      if (result.error === 'mixed_schedule_scope') {
        return validationError('同日・同担当・同拠点の訪問予定のみを一括化できます');
      }
      if (result.error === 'mixed_facility') {
        return validationError('同一施設の訪問予定のみを一括化できます', {
          facilities: result.facilities,
        });
      }
      if (result.error === 'mixed_existing_batch') {
        return validationError('異なる施設バッチに属する予定が混在しています');
      }
      if (result.error === 'mixed_facility_unit') {
        return validationError('同一ユニットの訪問予定のみを一括化できます');
      }
      if (result.error === 'not_enough_schedules') {
        return validationError('施設一括訪問を作成するには2件以上の訪問予定が必要です');
      }
      if (result.error === 'ordered_length_mismatch') {
        return validationError('順序指定と自動取得された訪問予定数が一致しません');
      }
      if (result.error === 'ordered_contains_unknown') {
        return validationError('順序指定に自動取得対象外の訪問予定が含まれています');
      }
    }

    await notifyWorkflowMutation({
      orgId: req.orgId,
      payload: { source: 'facility_visit_batches_upsert' },
    });

    return success(result, 201);
  },
  {
    permission: 'canVisit',
    message: '施設一括訪問の更新権限がありません',
  }
);
