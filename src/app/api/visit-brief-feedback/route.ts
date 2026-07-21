import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError, notFound } from '@/lib/api/response';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withOrgContext } from '@/lib/db/rls';
import { canAccessPatient } from '@/server/services/patient-access';

const boundedId = z.string().trim().min(1).max(191);

const feedbackSchema = z.object({
  patient_id: boundedId,
  context: z.enum(['patient', 'schedule']),
  generation_id: boundedId,
  summary_kind: z.enum(['ai', 'rule']),
  rating: z.enum(['helpful', 'needs_review']),
  comment: z.string().max(500).optional(),
  // 「一部修正する」で薬剤師が編集・保存した訂正後の本文。AuditLog の changes に構造化保存する。
  corrected_summary: z.string().min(1).max(2000).optional(),
  provider: z.string().max(100).optional(),
  requested_provider: z.string().max(100).optional(),
  model: z.string().max(191).nullable().optional(),
  is_fallback: z.boolean().optional(),
});

const authenticatedPOST = async (req: NextRequest, ctx: AuthContext) => {
  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = feedbackSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const feedbackRecorded = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const canAccessTargetPatient = await canAccessPatient({
        db: tx,
        orgId: ctx.orgId,
        patientId: parsed.data.patient_id,
        accessContext: { userId: ctx.userId, role: ctx.role },
      });
      if (!canAccessTargetPatient) return false;

      await createAuditLogEntry(tx, ctx, {
        action:
          parsed.data.rating === 'helpful'
            ? 'visit_brief_feedback_helpful'
            : 'visit_brief_feedback_needs_review',
        targetType: 'visit_brief_feedback',
        targetId: parsed.data.generation_id,
        changes: {
          patient_id: parsed.data.patient_id,
          context: parsed.data.context,
          summary_kind: parsed.data.summary_kind,
          rating: parsed.data.rating,
          comment: parsed.data.comment ?? null,
          corrected_summary: parsed.data.corrected_summary ?? null,
          provider: parsed.data.provider ?? null,
          requested_provider: parsed.data.requested_provider ?? null,
          model: parsed.data.model ?? null,
          is_fallback: parsed.data.is_fallback ?? false,
        },
      });
      return true;
    },
    {
      requestContext: ctx,
    },
  );

  // Access-scope and tenant misses stay indistinguishable from absent patients.
  if (!feedbackRecorded) return notFound('患者が見つかりません');

  return success({ data: { ok: true } }, 201);
};

export const POST = withAuthContext(authenticatedPOST, {
  permission: 'canVisit',
  message: '訪問要約フィードバックの送信権限がありません',
});
