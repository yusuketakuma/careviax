import { deriveFacilityLabel } from '@/lib/utils/facility';

type Residence = {
  building_id?: string | null;
  address?: string | null;
};

type ScheduleForEnrichment = {
  pharmacist_id: string;
  scheduled_date: Date;
  priority: string;
  assignment_mode: string;
  site?: { id: string } | null;
  facility_batch?: { id: string } | null;
  override_request?: { status: string } | null;
  applied_override?: object | null;
  preparation?: { prepared_at: Date | null } | null;
  case_: {
    patient: {
      name: string;
      residences: Residence[];
    };
  };
};

type EnrichmentHints = {
  facility_batch_id: string | null;
  facility_hint: {
    label: string;
    patient_count: number;
    patient_names: string[];
  } | null;
  workload_hint: {
    daily_visit_count: number;
    urgent_visit_count: number;
  };
  handoff_hint: {
    summary: string;
  } | null;
};

export function enrichSchedulesWithHints<T extends ScheduleForEnrichment>(
  schedules: T[]
): (T & EnrichmentHints)[] {
  const dailyWorkload = new Map<string, { count: number; urgentCount: number }>();
  const facilityGroups = new Map<string, { label: string; patientNames: string[] }>();

  for (const schedule of schedules) {
    const workloadKey = `${schedule.pharmacist_id}:${schedule.scheduled_date.toISOString().slice(0, 10)}`;
    const existingWorkload = dailyWorkload.get(workloadKey);
    if (existingWorkload) {
      existingWorkload.count += 1;
      if (schedule.priority !== 'normal') existingWorkload.urgentCount += 1;
    } else {
      dailyWorkload.set(workloadKey, {
        count: 1,
        urgentCount: schedule.priority !== 'normal' ? 1 : 0,
      });
    }

    const residence = schedule.case_.patient.residences[0];
    const facilityLabel = deriveFacilityLabel(residence ?? null);
    if (!facilityLabel) continue;
    const facilityKey = [
      schedule.scheduled_date.toISOString().slice(0, 10),
      schedule.pharmacist_id,
      schedule.site?.id ?? 'site:none',
      facilityLabel,
    ].join(':');
    const existingFacilityGroup = facilityGroups.get(facilityKey);
    if (existingFacilityGroup) {
      existingFacilityGroup.patientNames.push(schedule.case_.patient.name);
    } else {
      facilityGroups.set(facilityKey, {
        label: facilityLabel,
        patientNames: [schedule.case_.patient.name],
      });
    }
  }

  return schedules.map((schedule) => {
    const workloadKey = `${schedule.pharmacist_id}:${schedule.scheduled_date.toISOString().slice(0, 10)}`;
    const residence = schedule.case_.patient.residences[0];
    const facilityLabel = deriveFacilityLabel(residence ?? null);
    const facilityKey = facilityLabel
      ? [
          schedule.scheduled_date.toISOString().slice(0, 10),
          schedule.pharmacist_id,
          schedule.site?.id ?? 'site:none',
          facilityLabel,
        ].join(':')
      : null;
    const facilityGroup = facilityKey ? facilityGroups.get(facilityKey) : null;
    const handoffReasons = [
      ...(schedule.assignment_mode === 'fallback' ? ['代替担当での訪問です'] : []),
      ...(schedule.override_request?.status === 'pending'
        ? ['確定予定の変更承認待ちです']
        : []),
      ...(schedule.applied_override ? ['例外変更から再構成された予定です'] : []),
      ...(!schedule.preparation?.prepared_at ? ['訪問準備が未完了です'] : []),
    ];

    return {
      ...schedule,
      facility_batch_id: schedule.facility_batch?.id ?? null,
      facility_hint:
        facilityGroup && facilityGroup.patientNames.length > 1
          ? {
              label: facilityGroup.label,
              patient_count: facilityGroup.patientNames.length,
              patient_names: facilityGroup.patientNames,
            }
          : null,
      workload_hint: {
        daily_visit_count: dailyWorkload.get(workloadKey)?.count ?? 1,
        urgent_visit_count: dailyWorkload.get(workloadKey)?.urgentCount ?? 0,
      },
      handoff_hint:
        handoffReasons.length > 0
          ? {
              summary: handoffReasons.join(' / '),
            }
          : null,
    };
  });
}
