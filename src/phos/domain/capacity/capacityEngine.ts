import {
  BlockerSeverity,
  CapacityStatus,
  type CapacityBottleneck,
  type CapacityResponse,
  type CapacityScope,
  type CapacityStaffLoad,
  type CapacityWorkBucket,
} from '@/phos/contracts/phos_contracts';

export type CapacityEngineInput = {
  date: string;
  scope: CapacityScope;
  work_buckets: CapacityWorkBucket[];
  staff_loads: CapacityStaffLoad[];
  bottlenecks: CapacityBottleneck[];
  server_time: string;
};

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function utilizationPercent(planned: number, available: number): number {
  if (available <= 0) return planned > 0 ? 100 : 0;
  return Math.round((planned / available) * 100);
}

function hasCriticalBottleneck(bottlenecks: readonly CapacityBottleneck[]): boolean {
  return bottlenecks.some((bottleneck) => bottleneck.severity === BlockerSeverity.CRITICAL);
}

export function resolveCapacityStatus(input: {
  total_planned_minutes: number;
  total_available_minutes: number;
  utilization_percent: number;
  bottlenecks: readonly CapacityBottleneck[];
}): CapacityStatus {
  if (input.total_available_minutes <= 0) return CapacityStatus.UNREGISTERED;
  if (input.utilization_percent >= 100 || hasCriticalBottleneck(input.bottlenecks)) {
    return CapacityStatus.OVER_CAPACITY;
  }
  if (input.utilization_percent >= 85 || input.bottlenecks.length > 0) {
    return CapacityStatus.TIGHT;
  }
  return CapacityStatus.AVAILABLE;
}

export function resolveCapacity(input: CapacityEngineInput): CapacityResponse {
  const staffAvailable = sum(input.staff_loads.map((staff) => staff.available_minutes));
  const staffPlanned = sum(input.staff_loads.map((staff) => staff.planned_minutes));
  const bucketAvailable = sum(input.work_buckets.map((bucket) => bucket.available_minutes));
  const bucketPlanned = sum(input.work_buckets.map((bucket) => bucket.planned_minutes));
  const total_available_minutes = staffAvailable > 0 ? staffAvailable : bucketAvailable;
  const total_planned_minutes = staffPlanned > 0 ? staffPlanned : bucketPlanned;
  const utilization_percent = utilizationPercent(total_planned_minutes, total_available_minutes);

  return {
    date: input.date,
    scope: input.scope,
    status: resolveCapacityStatus({
      total_available_minutes,
      total_planned_minutes,
      utilization_percent,
      bottlenecks: input.bottlenecks,
    }),
    total_planned_minutes,
    total_available_minutes,
    utilization_percent,
    work_buckets: input.work_buckets,
    staff_loads: input.staff_loads,
    bottlenecks: input.bottlenecks,
    server_time: input.server_time,
  };
}
