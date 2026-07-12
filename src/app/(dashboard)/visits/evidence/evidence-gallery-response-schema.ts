import { z } from 'zod';

const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);
const nullableDateTime = z.string().datetime({ offset: true }).nullable();

const evidenceAttachmentSchema = z
  .object({
    file_id: nonEmptyText(255),
    file_name: nonEmptyText(1_000),
    uploaded_at: nullableDateTime,
    kind: z.enum(['photo', 'attachment']),
  })
  .strict();

const evidenceVisitRecordSchema = z
  .object({
    id: nonEmptyText(255),
    visit_date: z.string().datetime({ offset: true }),
    created_at: nullableDateTime,
    attachments: z.array(evidenceAttachmentSchema).max(100),
  })
  .strict();

export const evidenceGalleryResponseSchema = z
  .object({
    data: z.array(evidenceVisitRecordSchema).max(12),
    meta: z
      .object({
        has_more: z.boolean(),
        next_cursor: nonEmptyText(4_096).nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.meta.has_more !== (payload.meta.next_cursor !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'next_cursor'],
        message: 'Pagination cursor must match has_more',
      });
    }

    const recordIds = new Set<string>();
    const attachmentIds = new Set<string>();
    for (const [recordIndex, record] of payload.data.entries()) {
      if (recordIds.has(record.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', recordIndex, 'id'],
          message: 'Duplicate visit record identity',
        });
      }
      recordIds.add(record.id);

      for (const [attachmentIndex, attachment] of record.attachments.entries()) {
        if (attachmentIds.has(attachment.file_id)) {
          context.addIssue({
            code: 'custom',
            path: ['data', recordIndex, 'attachments', attachmentIndex, 'file_id'],
            message: 'Duplicate evidence attachment identity',
          });
        }
        attachmentIds.add(attachment.file_id);
      }
    }
  })
  .transform((payload) => payload.data);
