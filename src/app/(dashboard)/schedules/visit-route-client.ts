export type VisitScheduleRouteUpdate = {
  scheduleId: string;
  route_order: number;
  scheduled_date?: string;
  pharmacist_id?: string;
};

export type VisitScheduleProposalRouteUpdate = {
  proposal_id: string;
  route_order: number;
};

export async function applyVisitScheduleRouteUpdates(args: {
  orgId: string;
  updates: VisitScheduleRouteUpdate[];
}) {
  const response = await fetch('/api/visit-schedules/reorder', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-org-id': args.orgId,
    },
    body: JSON.stringify({
      updates: args.updates.map((update) => ({
        schedule_id: update.scheduleId,
        route_order: update.route_order,
        ...(update.scheduled_date ? { scheduled_date: update.scheduled_date } : {}),
        ...(update.pharmacist_id ? { pharmacist_id: update.pharmacist_id } : {}),
      })),
    }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message ?? '訪問予定の順路更新に失敗しました');
  }
  return response.json();
}

export async function applyVisitScheduleProposalRouteUpdates(args: {
  orgId: string;
  orderedProposalIds?: string[];
  routeOrderUpdates?: VisitScheduleProposalRouteUpdate[];
}) {
  const body =
    args.routeOrderUpdates && args.routeOrderUpdates.length > 0
      ? { route_order_updates: args.routeOrderUpdates }
      : { ordered_proposal_ids: args.orderedProposalIds ?? [] };

  const response = await fetch('/api/visit-schedule-proposals/reorder', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-org-id': args.orgId,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message ?? '訪問候補の順路更新に失敗しました');
  }
  return response.json();
}
