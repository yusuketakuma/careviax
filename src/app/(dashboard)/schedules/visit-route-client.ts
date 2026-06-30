export type VisitScheduleRouteUpdate = {
  scheduleId: string;
  route_order: number;
  scheduled_date?: string;
  pharmacist_id?: string;
};

export type VisitScheduleVehicleAssignment = {
  mode: 'assign_if_unassigned';
  vehicle_resource_id: string;
  schedule_ids: string[];
};

export type VisitScheduleProposalRouteUpdate = {
  proposal_id: string;
  route_order: number;
};

export type VisitMixedRouteUpdate = {
  item_type: 'schedule' | 'proposal';
  id: string;
  route_order: number;
};

export type VisitRouteConfirmationSource =
  | 'schedule_day_route_preview'
  | 'schedule_conflict_resolution'
  | 'route_compare_adoption'
  | 'emergency_route_interruption'
  | 'proposal_detail_route_preview'
  | 'weekly_optimizer_mixed_route_preview';

export type VisitRouteConfirmationContext = {
  source: VisitRouteConfirmationSource;
  date?: string;
  pharmacist_id?: string;
  travel_mode?: 'DRIVE' | 'BICYCLE' | 'WALK' | 'TWO_WHEELER';
  target_count?: number;
  route_order_diff_count?: number;
  vehicle_assignment_count?: number;
};

export async function applyVisitScheduleRouteUpdates(args: {
  orgId: string;
  updates: VisitScheduleRouteUpdate[];
  vehicleAssignment?: VisitScheduleVehicleAssignment;
  confirmationContext?: VisitRouteConfirmationContext;
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
      ...(args.vehicleAssignment ? { vehicle_assignment: args.vehicleAssignment } : {}),
      ...(args.confirmationContext ? { confirmation_context: args.confirmationContext } : {}),
    }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message ?? '訪問予定の順路更新に失敗しました');
  }
  return response.json();
}

export async function applyMixedVisitRouteUpdates(args: {
  orgId: string;
  updates: VisitMixedRouteUpdate[];
  confirmationContext?: VisitRouteConfirmationContext;
}) {
  const response = await fetch('/api/visit-routes/reorder', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-org-id': args.orgId,
    },
    body: JSON.stringify({
      updates: args.updates,
      ...(args.confirmationContext ? { confirmation_context: args.confirmationContext } : {}),
    }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message ?? '混在ルート順の更新に失敗しました');
  }
  return response.json();
}

export async function applyVisitScheduleProposalRouteUpdates(args: {
  orgId: string;
  orderedProposalIds?: string[];
  routeOrderUpdates?: VisitScheduleProposalRouteUpdate[];
  confirmationContext?: VisitRouteConfirmationContext;
}) {
  const routeOrderBody =
    args.routeOrderUpdates && args.routeOrderUpdates.length > 0
      ? { route_order_updates: args.routeOrderUpdates }
      : { ordered_proposal_ids: args.orderedProposalIds ?? [] };
  const body = {
    ...routeOrderBody,
    ...(args.confirmationContext ? { confirmation_context: args.confirmationContext } : {}),
  };

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
