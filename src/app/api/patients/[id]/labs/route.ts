import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

const createLabSchema = z.object({
  analyte_code: z.enum([
    'wbc', 'neut', 'hb', 'plt', 'pt_inr',
    'ast', 'alt', 't_bil', 'scr', 'egfr', 'ck', 'crp',
    'k', 'hba1c', 'tp', 'alb', 'na', 'cl', 'bun', 'bnp',
    'nt_pro_bnp', 'blood_glucose',
  ]),
  measured_at: z.string().datetime(),
  value_numeric: z.number().optional(),
  value_text: z.string().optional(),
  unit: z.string().optional(),
  abnormal_flag: z.string().optional(),
  reference_low: z.number().optional(),
  reference_high: z.number().optional(),
  source_type: z.enum(['manual', 'visit_record', 'import']).default('manual'),
  source_visit_record_id: z.string().optional(),
  note: z.string().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者情報の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  const patient = await prisma.patient.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true },
  });
  if (!patient) return notFound('患者が見つかりません');

  const url = new URL(req.url);
  const analyteCode = url.searchParams.get('analyte_code') ?? undefined;
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);

  const labs = await prisma.patientLabObservation.findMany({
    where: {
      org_id: ctx.orgId,
      patient_id: id,
      ...(analyteCode ? { analyte_code: analyteCode as never } : {}),
    },
    orderBy: [{ measured_at: 'desc' }, { created_at: 'desc' }],
    take: limit,
  });

  return success({ data: labs });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '検査値の登録権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createLabSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const patient = await prisma.patient.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true },
  });
  if (!patient) return notFound('患者が見つかりません');

  const lab = await withOrgContext(ctx.orgId, async (tx) => {
    return tx.patientLabObservation.create({
      data: {
        org_id: ctx.orgId,
        patient_id: id,
        analyte_code: parsed.data.analyte_code,
        measured_at: new Date(parsed.data.measured_at),
        value_numeric: parsed.data.value_numeric ?? null,
        value_text: parsed.data.value_text ?? null,
        unit: parsed.data.unit ?? null,
        abnormal_flag: parsed.data.abnormal_flag ?? null,
        reference_low: parsed.data.reference_low ?? null,
        reference_high: parsed.data.reference_high ?? null,
        source_type: parsed.data.source_type,
        source_visit_record_id: parsed.data.source_visit_record_id ?? null,
        note: parsed.data.note ?? null,
      },
    });
  }, { requestContext: ctx });

  return success(lab, 201);
}
