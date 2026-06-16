import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { forbidden, notFound, success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { canViewSensitivePatientData } from '@/lib/patient/sensitive';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { parseMedicalCareStationUrl } from '@/lib/patient-mcs/source';

const mcsLogCategoryLabels: Record<string, string> = {
  report: '報告確認',
  consultation: '相談確認',
  instruction_check: '指示確認',
  photo_review: '写真確認',
  urgent: '緊急確認',
  other: 'その他',
};

const createPatientMcsLogSchema = z.object({
  content_type: z
    .enum(['report', 'consultation', 'instruction_check', 'photo_review', 'urgent', 'other'])
    .default('report'),
  summary: z.string().trim().min(1, '要約は必須です').max(1000, '要約は1000文字以内です'),
  next_action: z.string().trim().max(500, '次アクションは500文字以内です').optional(),
  occurred_at: z.string().datetime('日時形式が不正です').optional(),
});

function resolveSafeMcsContactUrl(link: {
  mcs_project_url: string | null;
  source_url: string | null;
}) {
  return (
    parseMedicalCareStationUrl(link.mcs_project_url)?.toString() ??
    parseMedicalCareStationUrl(link.source_url)?.toString() ??
    null
  );
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: 'MCS 連携ログの作成権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;
  if (!canViewSensitivePatientData(ctx.role)) {
    return forbidden('MCS 連携ログの作成権限がありません');
  }

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = createPatientMcsLogSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const patient = await prisma.patient.findFirst({
    where: applyPatientAssignmentWhere(
      { id, org_id: ctx.orgId },
      { userId: ctx.userId, role: ctx.role },
    ),
    select: { id: true },
  });
  if (!patient) return notFound('患者が見つかりません');

  const link = await prisma.patientMcsLink.findUnique({
    where: { patient_id: id },
    select: {
      source_url: true,
      mcs_project_url: true,
      project_title: true,
    },
  });

  const categoryLabel = mcsLogCategoryLabels[parsed.data.content_type] ?? 'MCS確認';
  const content = [
    parsed.data.summary,
    parsed.data.next_action ? `次アクション: ${parsed.data.next_action}` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n');

  const event = await withOrgContext(ctx.orgId, async (tx) =>
    tx.communicationEvent.create({
      data: {
        org_id: ctx.orgId,
        patient_id: id,
        event_type: 'mcs_check',
        channel: 'ph_os_share',
        direction: 'inbound',
        counterpart_name: link?.project_title ?? 'MCS',
        counterpart_contact: link ? resolveSafeMcsContactUrl(link) : null,
        subject: `MCS ${categoryLabel}`,
        content,
        occurred_at: parsed.data.occurred_at ? new Date(parsed.data.occurred_at) : new Date(),
      },
    }),
  );

  return success({ data: event }, 201);
}
