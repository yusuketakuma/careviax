import type { QueryClient } from '@tanstack/react-query';

type QueryKey = readonly unknown[];

type PatientQueryArgs = {
  orgId: string;
  patientId: string;
};

type VisitExecutionQueryArgs = PatientQueryArgs & {
  scheduleId: string;
};

export function getPatientCareQueryKeys(args: PatientQueryArgs): QueryKey[] {
  return [
    ['patient', args.patientId, args.orgId],
    ['patient-overview', args.patientId, args.orgId],
    ['patient-communications', args.patientId, args.orgId],
    ['patient-documents', args.patientId, args.orgId],
    ['patient-movement-timeline', args.patientId, args.orgId],
    ['patient-readiness', args.patientId, args.orgId],
    ['patient-contacts', args.patientId, args.orgId],
    ['patients', args.orgId],
    ['patient-visit-records', args.patientId, args.orgId],
    ['visit-constraints', args.orgId, args.patientId],
    ['dashboard', 'patients', args.orgId],
    ['visit-schedules', 'week-board', args.orgId],
    ['visit-schedules', 'calendar', args.orgId],
    ['my-day-visits', args.orgId],
    ['cases', 'schedule-planner', args.orgId],
    ['visit-schedule-proposals', args.orgId],
  ];
}

export function getVisitExecutionQueryKeys(args: VisitExecutionQueryArgs): QueryKey[] {
  return [
    ['schedule', args.scheduleId, args.orgId],
    ...getPatientCareQueryKeys(args),
    ['dashboard', 'actions', args.orgId],
    ['dashboard-workflow', args.orgId],
    ['tasks', 'schedule-board', args.orgId],
    ['tasks', 'visit-contact-followup', args.orgId],
  ];
}

export async function invalidateQueryKeys(queryClient: QueryClient, keys: QueryKey[]) {
  await Promise.all(
    keys.map((queryKey) =>
      queryClient.invalidateQueries({
        queryKey,
      }),
    ),
  );
}
