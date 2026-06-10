import { formatNullableDateKey } from '@/lib/date-key';

export type PcaPumpRentalDateFields = {
  rented_at: Date;
  due_at: Date | null;
  returned_at: Date | null;
  inspected_at?: Date | null;
  created_at: Date;
  updated_at: Date;
};

export function toDateKey(value: Date | null) {
  return formatNullableDateKey(value);
}

export function serializePcaPumpRental<T extends PcaPumpRentalDateFields>(item: T) {
  return {
    ...item,
    rented_at: toDateKey(item.rented_at),
    due_at: toDateKey(item.due_at),
    returned_at: toDateKey(item.returned_at),
    inspected_at: item.inspected_at?.toISOString() ?? null,
    created_at: item.created_at.toISOString(),
    updated_at: item.updated_at.toISOString(),
  };
}
