import { z } from 'zod';
import type { CapturePatientSafety } from './capture.shared';

const text = (max = 1_000) => z.string().trim().min(1).max(max);
const dateTime = z.string().datetime({ offset: true });

export function buildCapturePatientNameResponseSchema(patientId: string) {
  return z
    .object({
      data: z
        .object({
          id: z.literal(patientId),
          name: text(),
        })
        .passthrough(),
    })
    .strict()
    .transform(({ data }) => data.name);
}

export const capturePatientSafetyResponseSchema = z
  .object({
    data: z
      .object({
        safety: z
          .object({
            visible_safety_tags: z.array(text(500)).max(20),
            hidden_safety_tag_count: z.number().int().nonnegative(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .strict()
  .transform(
    ({ data }): CapturePatientSafety => ({
      tags: Array.from(new Set(data.safety.visible_safety_tags)),
      hiddenCount: data.safety.hidden_safety_tag_count,
    }),
  );

export function buildCaptureVisitEndResponseSchema(args: {
  recordId: string;
  expectedVersion: number;
  endedAt: string;
}) {
  return z
    .object({
      data: z
        .object({
          id: z.literal(args.recordId),
          version: z.literal(args.expectedVersion + 1),
          visit_started_at: dateTime,
          visit_ended_at: z.literal(args.endedAt),
        })
        .passthrough(),
    })
    .strict()
    .transform(({ data }) => data.visit_ended_at);
}
