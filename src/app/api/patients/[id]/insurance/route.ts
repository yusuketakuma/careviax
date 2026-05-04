import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { notFound, success, validationError } from '@/lib/api/response';
import { z } from 'zod';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';

const insuranceSchema = z.object({
  insurance_type: z.enum(['medical', 'care', 'public_subsidy']),
  insurer_number: z.string().max(8).optional().nullable(),
  symbol: z.string().max(100).optional().nullable(),
  number: z.string().max(20).optional().nullable(),
  branch_number: z.string().max(2).optional().nullable(),
  copay_ratio: z.number().int().min(0).max(100).optional().nullable(),
  valid_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
    .optional()
    .nullable(),
  valid_until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
    .optional()
    .nullable(),
  is_active: z.boolean().optional(),
  notes: z.string().max(500).optional().nullable(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者保険情報の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  const patient = await prisma.patient.findFirst({
    where: applyPatientAssignmentWhere(
      { id, org_id: ctx.orgId },
      { userId: ctx.userId, role: ctx.role },
    ),
    select: { id: true },
  });
  if (!patient) return notFound('患者が見つかりません');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const insurances = await prisma.patientInsurance.findMany({
    where: { patient_id: id, org_id: ctx.orgId },
    orderBy: [{ is_active: 'desc' }, { valid_from: 'desc' }, { created_at: 'desc' }],
  });

  const current = insurances.filter(
    (ins) =>
      ins.is_active &&
      (!ins.valid_from || ins.valid_from <= today) &&
      (!ins.valid_until || ins.valid_until >= today),
  );
  const upcoming = insurances.filter(
    (ins) => ins.is_active && ins.valid_from && ins.valid_from > today,
  );
  const history = insurances.filter(
    (ins) => !ins.is_active || (ins.valid_until && ins.valid_until < today),
  );

  return success({ data: { current, upcoming, history, all: insurances } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者保険情報の登録権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = insuranceSchema.safeParse(body);
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

  const { valid_from, valid_until, ...rest } = parsed.data;

  const created = await withOrgContext(ctx.orgId, (tx) =>
    tx.patientInsurance.create({
      data: {
        org_id: ctx.orgId,
        patient_id: id,
        ...rest,
        valid_from: valid_from ? new Date(valid_from) : null,
        valid_until: valid_until ? new Date(valid_until) : null,
      },
    }),
  );

  return success({ data: created });
}
