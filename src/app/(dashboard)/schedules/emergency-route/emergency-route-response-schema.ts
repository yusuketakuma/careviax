import { z } from 'zod';

const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);
const nullableNonnegativeNumber = z.number().finite().nonnegative().nullable();
const timeWindowSchema = z
  .object({
    from: nonEmptyText(100),
    to: nonEmptyText(100),
  })
  .strict();

const stopSummarySchema = z
  .object({
    scheduleId: nonEmptyText(255),
    optimizedOrder: z.number().int().positive(),
    arrivalOffsetSeconds: nullableNonnegativeNumber,
    distanceFromPreviousMeters: nullableNonnegativeNumber,
    durationFromPreviousSeconds: nullableNonnegativeNumber,
    distanceSource: z.enum(['road', 'straight_line']).nullable().optional(),
    serviceDurationSeconds: nullableNonnegativeNumber.optional(),
    timeWindow: timeWindowSchema.nullable().optional(),
  })
  .strict();

const routePlanSchema = z
  .object({
    status: z.enum(['ok', 'unavailable']),
    note: z.string().max(5_000).nullable(),
    travelMode: z.enum(['DRIVE', 'BICYCLE', 'WALK', 'TWO_WHEELER']),
    origin: z
      .object({
        lat: z.number().finite().min(-90).max(90),
        lng: z.number().finite().min(-180).max(180),
        label: nonEmptyText(500),
      })
      .strict()
      .nullable(),
    encodedPath: z.string().max(1_000_000).nullable(),
    orderedScheduleIds: z.array(nonEmptyText(255)).max(50),
    totalDistanceMeters: nullableNonnegativeNumber,
    totalDurationSeconds: nullableNonnegativeNumber,
    distanceSource: z.enum(['road', 'straight_line', 'mixed']).nullable().optional(),
    stopSummaries: z.array(stopSummarySchema).max(50),
  })
  .strict()
  .superRefine((plan, context) => {
    const orderedIds = new Set<string>();
    for (const [index, scheduleId] of plan.orderedScheduleIds.entries()) {
      if (orderedIds.has(scheduleId)) {
        context.addIssue({
          code: 'custom',
          path: ['orderedScheduleIds', index],
          message: 'Duplicate ordered schedule identity',
        });
      }
      orderedIds.add(scheduleId);
    }

    const summaryIds = new Set<string>();
    const optimizedOrders = new Set<number>();
    for (const [index, summary] of plan.stopSummaries.entries()) {
      if (!orderedIds.has(summary.scheduleId) || summaryIds.has(summary.scheduleId)) {
        context.addIssue({
          code: 'custom',
          path: ['stopSummaries', index, 'scheduleId'],
          message: 'Stop summary identity must match one ordered schedule',
        });
      }
      summaryIds.add(summary.scheduleId);
      if (optimizedOrders.has(summary.optimizedOrder)) {
        context.addIssue({
          code: 'custom',
          path: ['stopSummaries', index, 'optimizedOrder'],
          message: 'Duplicate optimized order',
        });
      }
      optimizedOrders.add(summary.optimizedOrder);
    }
  });

export const emergencyRouteResponseSchema = z
  .object({ data: routePlanSchema })
  .strict()
  .transform((payload) => payload.data);
