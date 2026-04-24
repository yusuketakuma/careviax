import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { deriveVisitPlaceGroup } from '@/lib/utils/facility';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { upsertFacilityVisitDaysSchema } from '@/lib/validations/visit-constraints';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';

function toTimeValue(value?: string | null) {
  return value ? new Date(`1970-01-01T${value}`) : null;
}

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = upsertFacilityVisitDaysSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const scheduleIds = Array.from(new Set(parsed.data.schedule_ids));

    const result = await withOrgContext(req.orgId, async (tx) => {
      const schedules = await tx.visitSchedule.findMany({
        where: {
          org_id: req.orgId,
          id: {
            in: scheduleIds,
          },
        },
        select: {
          id: true,
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
                      address: true,
                      building_id: true,
                      facility_id: true,
                      facility_unit_id: true,
                      unit_name: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (schedules.length !== scheduleIds.length) {
        return { error: 'missing_schedule' as const };
      }

      const facilityLabels = Array.from(
        new Set(
          schedules
            .map((schedule) => deriveVisitPlaceGroup(schedule.case_.patient.residences[0] ?? null)?.label ?? null)
            .filter((value): value is string => value != null)
        )
      );

      if (facilityLabels.length !== 1 || facilityLabels[0] !== parsed.data.facility_label) {
        return {
          error: 'mixed_facility' as const,
          facilities: facilityLabels,
        };
      }

      const uniquePatients = Array.from(
        new Map(
          schedules.map((schedule) => [
            schedule.case_.patient.id,
            {
              id: schedule.case_.patient.id,
              name: schedule.case_.patient.name,
            },
          ])
        ).values()
      );

      await Promise.all(
        uniquePatients.map((patient) =>
          tx.patientSchedulePreference.upsert({
            where: {
              patient_id: patient.id,
            },
            create: {
              org_id: req.orgId,
              patient_id: patient.id,
              preferred_weekdays: parsed.data.preferred_weekdays,
              preferred_time_from: toTimeValue(parsed.data.preferred_time_from),
              preferred_time_to: toTimeValue(parsed.data.preferred_time_to),
              facility_time_from: toTimeValue(parsed.data.facility_time_from),
              facility_time_to: toTimeValue(parsed.data.facility_time_to),
              visit_buffer_minutes: parsed.data.visit_buffer_minutes ?? null,
              notes: parsed.data.notes ?? null,
            },
            update: {
              preferred_weekdays: parsed.data.preferred_weekdays,
              preferred_time_from: toTimeValue(parsed.data.preferred_time_from),
              preferred_time_to: toTimeValue(parsed.data.preferred_time_to),
              facility_time_from: toTimeValue(parsed.data.facility_time_from),
              facility_time_to: toTimeValue(parsed.data.facility_time_to),
              visit_buffer_minutes: parsed.data.visit_buffer_minutes ?? null,
              notes: parsed.data.notes ?? null,
            },
          })
        )
      );

      return {
        facility_label: parsed.data.facility_label,
        patient_count: uniquePatients.length,
        patient_names: uniquePatients.map((patient) => patient.name),
        preferred_weekdays: parsed.data.preferred_weekdays,
        preferred_time_from: parsed.data.preferred_time_from ?? null,
        preferred_time_to: parsed.data.preferred_time_to ?? null,
        facility_time_from: parsed.data.facility_time_from ?? null,
        facility_time_to: parsed.data.facility_time_to ?? null,
        visit_buffer_minutes: parsed.data.visit_buffer_minutes ?? null,
        notes: parsed.data.notes ?? null,
      };
    });

    if ('error' in result) {
      if (result.error === 'missing_schedule') {
        return validationError('訪問先グループの対象予定が見つかりません');
      }
      if (result.error === 'mixed_facility') {
        return validationError('同一訪問先グループの訪問予定のみをまとめて更新できます', {
          facilities: result.facilities,
        });
      }
    }

    await notifyWorkflowMutation({
      orgId: req.orgId,
      payload: { source: 'facility_visit_days_upsert' },
    });

    return success(result, 201);
  },
  {
    permission: 'canVisit',
    message: '訪問先グループ定期訪問日の更新権限がありません',
  }
);
