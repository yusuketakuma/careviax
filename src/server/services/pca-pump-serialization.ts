import { formatNullableDateKey } from '@/lib/date-key';

type PcaPumpMaintenanceEventDateFields = {
  performed_at: Date;
  created_at: Date;
  next_maintenance_due_at: Date | null;
};

export type PcaPumpDateFields = {
  maintenance_due_at: Date | null;
  created_at: Date;
  updated_at: Date;
  maintenance_events?: PcaPumpMaintenanceEventDateFields[];
};

export function toPcaPumpDateKey(value: Date | null) {
  return formatNullableDateKey(value);
}

export function serializePcaPump<T extends PcaPumpDateFields>(item: T) {
  return {
    ...item,
    maintenance_due_at: toPcaPumpDateKey(item.maintenance_due_at),
    maintenance_events: item.maintenance_events?.map((event) => ({
      ...event,
      performed_at: event.performed_at.toISOString(),
      created_at: event.created_at.toISOString(),
      next_maintenance_due_at: toPcaPumpDateKey(event.next_maintenance_due_at),
    })),
    created_at: item.created_at.toISOString(),
    updated_at: item.updated_at.toISOString(),
  };
}
