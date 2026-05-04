import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { notFound, success, validationError } from '@/lib/api/response';
import { buildPackagingInstructions } from '@/lib/prescription/packaging';
import { patientPackagingProfileSchema } from '@/lib/validations/patient-packaging';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者配薬設定の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id } = await params;
  const patient = await prisma.patient.findFirst({
    where: applyPatientAssignmentWhere(
      { id, org_id: ctx.orgId },
      { userId: ctx.userId, role: ctx.role },
    ),
    select: {
      id: true,
      packaging_profile: {
        select: {
          default_packaging_method: true,
          medication_box_color: true,
          notes: true,
          special_instructions: true,
          cognitive_note: true,
          updated_at: true,
        },
      },
    },
  });

  if (!patient) return notFound('患者が見つかりません');

  return success({
    data: {
      packaging_profile: patient.packaging_profile,
      effective_summary: buildPackagingInstructions({
        method: patient.packaging_profile?.default_packaging_method ?? null,
        detail: patient.packaging_profile?.notes ?? null,
        medicationBoxColor: patient.packaging_profile?.medication_box_color ?? null,
      }),
    },
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者配薬設定の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = patientPackagingProfileSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { id } = await params;
  const patient = await prisma.patient.findFirst({
    where: applyPatientAssignmentWhere(
      { id, org_id: ctx.orgId },
      { userId: ctx.userId, role: ctx.role },
    ),
    select: { id: true },
  });
  if (!patient) return notFound('患者が見つかりません');

  const profileData = {
    default_packaging_method: parsed.data.default_packaging_method ?? null,
    medication_box_color: parsed.data.medication_box_color || null,
    notes: parsed.data.notes || null,
    special_instructions: parsed.data.special_instructions || null,
    cognitive_note: parsed.data.cognitive_note || null,
  };

  const updated = await withOrgContext(ctx.orgId, async (tx) => {
    return tx.patientPackagingProfile.upsert({
      where: { patient_id: id },
      create: { org_id: ctx.orgId, patient_id: id, ...profileData },
      update: profileData,
      select: {
        default_packaging_method: true,
        medication_box_color: true,
        notes: true,
        special_instructions: true,
        cognitive_note: true,
        updated_at: true,
      },
    });
  });

  return success({
    data: updated,
    effective_summary: buildPackagingInstructions({
      method: updated.default_packaging_method ?? null,
      detail: updated.notes ?? null,
      medicationBoxColor: updated.medication_box_color ?? null,
    }),
  });
}
