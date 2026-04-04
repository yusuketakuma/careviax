import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { success, notFound, validationError, error } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { z } from 'zod';
import {
  createEPrescriptionAdapter,
  EPrescriptionAdapterError,
} from '@/server/adapters/e-prescription';

const fetchEPrescriptionSchema = z.object({
  prescription_id: z.string().min(1),
});

/**
 * POST /api/patients/[id]/prescriptions/e-prescription
 *
 * 電子処方箋管理サービスから処方箋を取得し、PrescriptionIntake として受付登録する。
 * JAHIS QR 以外の電子処方箋受付パス（処方箋IDを直接指定）。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '電子処方箋受付の権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: patientId } = await params;

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, org_id: ctx.orgId },
    select: { id: true, name: true },
  });
  if (!patient) return notFound('患者が見つかりません');

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = fetchEPrescriptionSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const adapter = createEPrescriptionAdapter({
    provider: (process.env.EPRESCRIPTION_PROVIDER as 'stub' | 'mhlw') ?? 'stub',
    baseUrl: process.env.EPRESCRIPTION_BASE_URL,
    apiKey: process.env.EPRESCRIPTION_API_KEY,
    accessToken: process.env.EPRESCRIPTION_ACCESS_TOKEN,
  });

  let ePrescription;
  try {
    ePrescription = await adapter.fetchPrescription(parsed.data.prescription_id);
  } catch (cause) {
    if (cause instanceof EPrescriptionAdapterError) {
      if (cause.code === 'NOT_IMPLEMENTED') {
        return error('EPRESCRIPTION_NOT_ENABLED', cause.message, 501);
      }
      return error('EPRESCRIPTION_UPSTREAM_FAILURE', cause.message, 502);
    }
    throw cause;
  }

  if (!ePrescription) return notFound('処方箋が見つかりません');

  // Find the most recent active MedicationCycle for this patient through their CareCase
  const intake = await withOrgContext(ctx.orgId, async (tx) => {
    const cycle = await tx.medicationCycle.findFirst({
      where: {
        org_id: ctx.orgId,
        patient_id: patientId,
        overall_status: { notIn: ['dispensed', 'audited'] },
      },
      orderBy: { created_at: 'desc' },
      select: { id: true },
    });

    if (!cycle) {
      return error(
        'NO_ACTIVE_CYCLE',
        'この患者にアクティブな服薬サイクルがありません。先にケースを開始してください。',
        422
      );
    }

    return tx.prescriptionIntake.create({
      data: {
        org_id: ctx.orgId,
        cycle_id: cycle.id,
        source_type: 'e_prescription',
        prescribed_date: ePrescription.issuedAt
          ? new Date(ePrescription.issuedAt)
          : new Date(),
        prescriber_name: ePrescription.prescriberName ?? null,
        prescriber_institution: ePrescription.prescriberInstitution ?? null,
        prescription_expiry_date: ePrescription.expiresAt
          ? new Date(ePrescription.expiresAt)
          : null,
        refill_remaining_count: ePrescription.refillRemainingCount ?? null,
        lines: {
          create: ePrescription.items.map((item) => ({
            org_id: ctx.orgId,
            line_number: item.lineNumber,
            drug_name: item.drugName,
            drug_code: item.drugCode ?? null,
            dose: item.dose,
            frequency: item.frequency,
            days: item.days,
            quantity: item.quantity ?? null,
            unit: item.unit ?? null,
            notes: item.notes ?? null,
          })),
        },
      },
      select: { id: true, cycle_id: true, prescribed_date: true, source_type: true },
    });
  });

  if (intake instanceof NextResponse) return intake;

  return success({ data: intake, e_prescription_id: ePrescription.prescriptionId }, 201);
}
