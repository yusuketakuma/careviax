import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { notFound, success, validationError } from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { billingPaymentProfileSchema } from '@/lib/validations/billing-collection';
import { buildPatientDetailWhere } from '@/server/services/patient-detail-scope';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import { prisma } from '@/lib/db/client';
import { requireWritablePatient } from '@/server/services/patient-write-guard';

const BILLING_PAYMENT_PROFILE_TASK_TYPE = 'patient_billing_payment_profile';

function normalizeNullableText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canManageBilling',
    message: '支払設定の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const patientId = normalizeRequiredRouteParam(rawId);
  if (!patientId) return validationError('患者IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = billingPaymentProfileSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const writable = await requireWritablePatient(prisma, ctx, patientId);
  if ('response' in writable) return writable.response;

  const profile = {
    payer_type: parsed.data.payer_type,
    payer_name: normalizeNullableText(parsed.data.payer_name),
    payer_relation: normalizeNullableText(parsed.data.payer_relation),
    billing_address_mode: parsed.data.billing_address_mode,
    billing_address: normalizeNullableText(parsed.data.billing_address),
    payment_method: parsed.data.payment_method,
    collection_timing: parsed.data.collection_timing,
    receipt_issue: parsed.data.receipt_issue,
    invoice_issue: parsed.data.invoice_issue,
    unpaid_tolerance: parsed.data.unpaid_tolerance,
    note: normalizeNullableText(parsed.data.note),
    updated_at: new Date().toISOString(),
    updated_by: ctx.userId,
  };

  const result = await withOrgContext(ctx.orgId, async (tx) => {
    const patient = await tx.patient.findFirst({
      where: buildPatientDetailWhere({
        orgId: ctx.orgId,
        patientId,
        role: ctx.role,
        userId: ctx.userId,
      }),
      select: { id: true, name: true },
    });
    if (!patient) return null;

    await upsertOperationalTask(tx, {
      orgId: ctx.orgId,
      taskType: BILLING_PAYMENT_PROFILE_TASK_TYPE,
      title: `${patient.name} 支払設定`,
      description: profile.note,
      priority: 'normal',
      status: 'completed',
      dedupeKey: `patient_billing_payment_profile:${patientId}`,
      relatedEntityType: 'patient',
      relatedEntityId: patientId,
      metadata: profile as Prisma.InputJsonObject,
    });

    await createAuditLogEntry(tx, ctx, {
      action: 'billing_payment_profile_updated',
      targetType: 'Patient',
      targetId: patientId,
      changes: profile,
    });

    return profile;
  });

  if (!result) return notFound('患者が見つかりません');

  return success({ data: { profile: result } });
}
