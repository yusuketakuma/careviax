export function buildScheduleFocusHref(scheduleId: string) {
  return `/schedules?focus=schedule&schedule_id=${encodeURIComponent(scheduleId)}`;
}

export function buildScheduleProposalDetailHref(proposalId: string) {
  return `/schedules/proposals?detail=${encodeURIComponent(proposalId)}`;
}

export function buildVisitScheduleHref(scheduleId: string) {
  return `/visit-schedules/${encodeURIComponent(scheduleId)}`;
}
