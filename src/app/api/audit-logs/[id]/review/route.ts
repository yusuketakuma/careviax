import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { internalError, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';

const reviewBodySchema = z.object({
  review_state: z.enum(['pending', 'reviewed']),
  reason_code: z
    .string()
    .trim()
    .regex(/^[a-z0-9_.:-]{1,80}$/)
    .optional(),
  reason_note: z.string().trim().max(500).optional(),
});

const authenticatedPATCH = withAuthContext(
  async (req, ctx, routeContext) => {
    const params = await routeContext.params;
    const auditLogId = params.id;
    if (!auditLogId) {
      return validationError('監査ログIDが不正です');
    }

    const parsed = reviewBodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return validationError('レビュー状態が不正です', parsed.error.flatten());
    }

    const auditLog = await prisma.auditLog.findFirst({
      where: {
        id: auditLogId,
        org_id: ctx.orgId,
      },
      select: {
        id: true,
        org_id: true,
      },
    });
    if (!auditLog) {
      return notFound('監査ログが見つかりません');
    }

    const now = new Date();
    const isReviewed = parsed.data.review_state === 'reviewed';
    const noteSummary: Prisma.InputJsonValue | typeof Prisma.DbNull = parsed.data.reason_note
      ? {
          present: true,
          length: parsed.data.reason_note.length,
          redacted: true,
        }
      : Prisma.DbNull;

    const review = await prisma.$transaction(async (tx) => {
      const row = await tx.auditLogReview.upsert({
        where: {
          org_id_audit_log_id: {
            org_id: ctx.orgId,
            audit_log_id: auditLog.id,
          },
        },
        create: {
          org_id: ctx.orgId,
          audit_log_id: auditLog.id,
          review_state: parsed.data.review_state,
          reviewed_by: isReviewed ? ctx.userId : null,
          reviewed_at: isReviewed ? now : null,
          reason_code: parsed.data.reason_code ?? null,
          reason_note: noteSummary,
        },
        update: {
          review_state: parsed.data.review_state,
          reviewed_by: isReviewed ? ctx.userId : null,
          reviewed_at: isReviewed ? now : null,
          reason_code: parsed.data.reason_code ?? null,
          reason_note: noteSummary,
        },
        select: {
          audit_log_id: true,
          review_state: true,
          reviewed_at: true,
          reviewed_by: true,
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: isReviewed ? 'audit_log_reviewed' : 'audit_log_review_reopened',
        targetType: 'audit_log',
        targetId: auditLog.id,
        changes: {
          review_state: parsed.data.review_state,
          reason_code: parsed.data.reason_code ?? null,
          reason_note_present: Boolean(parsed.data.reason_note),
          reason_note_length: parsed.data.reason_note?.length ?? 0,
          reason_note_redacted: Boolean(parsed.data.reason_note),
        },
      });

      return row;
    });

    return success({
      data: {
        audit_log_id: review.audit_log_id,
        review_state: review.review_state === 'reviewed' ? 'reviewed' : 'pending',
        reviewed_at: review.reviewed_at?.toISOString() ?? null,
        reviewed_by: review.reviewed_by,
      },
    });
  },
  { permission: 'canAdmin' },
);

export const PATCH: typeof authenticatedPATCH = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPATCH(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
