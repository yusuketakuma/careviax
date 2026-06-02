import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';

const feedbackSchema = z.object({
  patient_id: z.string().min(1),
  context: z.enum(['patient', 'schedule']),
  generation_id: z.string().min(1),
  summary_kind: z.enum(['ai', 'rule']),
  rating: z.enum(['helpful', 'needs_review']),
  comment: z.string().max(500).optional(),
  provider: z.string().optional(),
  requested_provider: z.string().optional(),
  model: z.string().nullable().optional(),
  is_fallback: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問要約フィードバックの送信権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = feedbackSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  await withOrgContext(
    ctx.orgId,
    async (tx) => {
      await tx.auditLog.create({
        data: {
          org_id: ctx.orgId,
          actor_id: ctx.userId,
          action:
            parsed.data.rating === 'helpful'
              ? 'visit_brief_feedback_helpful'
              : 'visit_brief_feedback_needs_review',
          target_type: 'visit_brief_feedback',
          target_id: parsed.data.generation_id,
          changes: {
            patient_id: parsed.data.patient_id,
            context: parsed.data.context,
            summary_kind: parsed.data.summary_kind,
            rating: parsed.data.rating,
            comment: parsed.data.comment ?? null,
            provider: parsed.data.provider ?? null,
            requested_provider: parsed.data.requested_provider ?? null,
            model: parsed.data.model ?? null,
            is_fallback: parsed.data.is_fallback ?? false,
          },
        },
      });
    },
    {
      requestContext: ctx,
    },
  );

  return success({ ok: true }, 201);
}
