import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const nullableText = (max: number) => z.string().max(max).nullable();
const offsetDateTime = z.string().datetime({ offset: true });
const laneSchema = z.enum(['fax', 'online', 'walk_in']);
const statusSchema = z.enum([
  'unblock_related',
  'acceptance_pending',
  'duplicate_suspected',
  'entry_pending',
  'inquiry_waiting',
  'entered_in_progress',
  'imported',
  'on_hold',
]);
const actionSchema = z.enum([
  'send_to_entry',
  'compare',
  'to_dashboard',
  'to_audit',
  'to_dispensing',
  'to_set',
  'to_card',
]);

const triageRowSchema = z
  .object({
    intake_id: text(200),
    cycle_id: text(200),
    patient_id: text(200),
    patient_name: text(500),
    received_at: offsetDateTime,
    lane: laneSchema,
    issuer: nullableText(1_000),
    content_label: text(1_000),
    rx_number: nullableText(200),
    auto_read_percent: z.number().int().min(50).max(99).nullable(),
    status: statusSchema,
    duplicate_of_date: z
      .string()
      .regex(/^\d{1,2}\/\d{1,2}$/)
      .nullable(),
    action: actionSchema,
  })
  .strict();

export const intakeTriageResponseSchema = z
  .object({
    data: z
      .object({
        generated_at: offsetDateTime,
        new_today_count: z.number().int().nonnegative(),
        needs_decision_count: z.number().int().nonnegative(),
        lane_counts: z
          .object({
            fax: z.number().int().nonnegative(),
            online: z.number().int().nonnegative(),
            walk_in: z.number().int().nonnegative(),
          })
          .strict(),
        rows: z.array(triageRowSchema).max(50),
        duplicate_notices: z
          .array(
            z
              .object({
                intake_id: text(200),
                patient_name: text(500),
                lane: laneSchema,
                matched_date: z.string().regex(/^\d{1,2}\/\d{1,2}$/),
              })
              .strict(),
          )
          .max(50),
        evidence: z
          .object({
            fax_document_count: z.number().int().nonnegative(),
            reader_model_version: nullableText(100),
            discard_count_this_month: z.number().int().nonnegative(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine(({ data }, context) => {
    const ids = new Set<string>();
    const laneCounts = { fax: 0, online: 0, walk_in: 0 };
    let decisionCount = 0;
    let previousReceivedAt: string | null = null;
    for (const [index, row] of data.rows.entries()) {
      if (ids.has(row.intake_id))
        context.addIssue({
          code: 'custom',
          path: ['data', 'rows', index, 'intake_id'],
          message: 'Duplicate intake identity',
        });
      ids.add(row.intake_id);
      laneCounts[row.lane] += 1;
      if (['acceptance_pending', 'duplicate_suspected', 'on_hold'].includes(row.status))
        decisionCount += 1;
      if (previousReceivedAt && row.received_at > previousReceivedAt)
        context.addIssue({
          code: 'custom',
          path: ['data', 'rows', index, 'received_at'],
          message: 'Intake rows are not newest first',
        });
      previousReceivedAt = row.received_at;
      const hasDuplicateDate = row.duplicate_of_date !== null;
      if (
        (row.status === 'duplicate_suspected') !== hasDuplicateDate ||
        (hasDuplicateDate && row.action !== 'compare')
      )
        context.addIssue({
          code: 'custom',
          path: ['data', 'rows', index],
          message: 'Duplicate intake presentation drift',
        });
    }
    for (const lane of laneSchema.options) {
      if (data.lane_counts[lane] !== laneCounts[lane])
        context.addIssue({
          code: 'custom',
          path: ['data', 'lane_counts', lane],
          message: 'Intake lane count drift',
        });
    }
    if (data.needs_decision_count !== decisionCount)
      context.addIssue({
        code: 'custom',
        path: ['data', 'needs_decision_count'],
        message: 'Intake decision count drift',
      });
    const noticeIds = new Set<string>();
    for (const [index, notice] of data.duplicate_notices.entries()) {
      const row = data.rows.find((candidate) => candidate.intake_id === notice.intake_id);
      if (
        !row ||
        row.status !== 'duplicate_suspected' ||
        row.patient_name !== notice.patient_name ||
        row.lane !== notice.lane ||
        row.duplicate_of_date !== notice.matched_date ||
        noticeIds.has(notice.intake_id)
      )
        context.addIssue({
          code: 'custom',
          path: ['data', 'duplicate_notices', index],
          message: 'Duplicate notice does not match its intake row',
        });
      noticeIds.add(notice.intake_id);
    }
    if (data.rows.filter((row) => row.status === 'duplicate_suspected').length !== noticeIds.size)
      context.addIssue({
        code: 'custom',
        path: ['data', 'duplicate_notices'],
        message: 'Duplicate notice coverage drift',
      });
    if (data.evidence.fax_document_count > data.lane_counts.fax)
      context.addIssue({
        code: 'custom',
        path: ['data', 'evidence', 'fax_document_count'],
        message: 'FAX evidence count exceeds visible FAX rows',
      });
  });

export {
  dailyOpsCockpitResponseSchema as intakeCockpitResponseSchema,
  type DailyOpsCockpitData as IntakeCockpitData,
} from '@/lib/workspace/daily-ops-cockpit-response-schema';
