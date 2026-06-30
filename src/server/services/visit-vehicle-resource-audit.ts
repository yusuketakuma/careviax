import type { Prisma } from '@prisma/client';
import { formatUtcDateKey } from '@/lib/date-key';

type VisitVehicleResourceAuditSnapshot = {
  site_id: string;
  label: string;
  vehicle_code: string | null;
  travel_mode: string;
  max_stops: number;
  max_route_duration_minutes: number | null;
  available: boolean;
  next_inspection_date?: Date | null;
  notes?: string | null;
};

type AuditScalar = string | number | boolean | null;

function dateAuditValue(value: Date | null | undefined) {
  return value ? formatUtcDateKey(value) : null;
}

function hasNotes(value: string | null | undefined) {
  return Boolean(value?.trim());
}

export function buildVisitVehicleResourceCreatedAuditChanges(
  resource: VisitVehicleResourceAuditSnapshot,
): Prisma.InputJsonValue {
  return {
    site_id: resource.site_id,
    label: resource.label,
    vehicle_code: resource.vehicle_code,
    travel_mode: resource.travel_mode,
    max_stops: resource.max_stops,
    max_route_duration_minutes: resource.max_route_duration_minutes,
    available: resource.available,
    next_inspection_date: dateAuditValue(resource.next_inspection_date),
    notes_present: hasNotes(resource.notes),
  };
}

export function buildVisitVehicleResourceUpdatedAuditChanges(
  from: VisitVehicleResourceAuditSnapshot,
  to: VisitVehicleResourceAuditSnapshot,
): Record<string, Prisma.InputJsonValue> {
  const changes: Record<string, Prisma.InputJsonValue> = {};
  const add = (key: string, fromValue: AuditScalar, toValue: AuditScalar) => {
    if (fromValue === toValue) return;
    changes[key] = { from: fromValue, to: toValue };
  };

  add('label', from.label, to.label);
  add('vehicle_code', from.vehicle_code, to.vehicle_code);
  add('travel_mode', from.travel_mode, to.travel_mode);
  add('max_stops', from.max_stops, to.max_stops);
  add('max_route_duration_minutes', from.max_route_duration_minutes, to.max_route_duration_minutes);
  add('available', from.available, to.available);
  add(
    'next_inspection_date',
    dateAuditValue(from.next_inspection_date),
    dateAuditValue(to.next_inspection_date),
  );

  if ((from.notes ?? null) !== (to.notes ?? null)) {
    changes.notes = {
      changed: true,
      from_present: hasNotes(from.notes),
      to_present: hasNotes(to.notes),
    };
  }

  return changes;
}
