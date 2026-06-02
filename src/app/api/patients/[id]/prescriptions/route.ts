import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { success, notFound, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { decodeKeysetCursor, encodeKeysetCursor } from '@/lib/api/keyset-cursor';
import { prisma } from '@/lib/db/client';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import type { Prisma } from '@prisma/client';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { listAccessiblePatientCaseIds } from '@/server/services/patient-access';

const PATIENT_PRESCRIPTION_CURSOR_KEYS = ['prescribed_date', 'created_at'] as const;

function buildKeysetWhere(
  cursor: ReturnType<typeof decodeKeysetCursor<(typeof PATIENT_PRESCRIPTION_CURSOR_KEYS)[number]>>,
): Prisma.PrescriptionIntakeWhereInput | null {
  if (!cursor) return null;

  return {
    OR: [
      { prescribed_date: { lt: cursor.prescribed_date } },
      {
        prescribed_date: cursor.prescribed_date,
        created_at: { lt: cursor.created_at },
      },
      {
        prescribed_date: cursor.prescribed_date,
        created_at: cursor.created_at,
        id: { lt: cursor.id },
      },
    ],
  };
}

export const GET = withAuthContext(
  async (req: NextRequest, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id: rawPatientId } = await params;
    const patientId = normalizeRequiredRouteParam(rawPatientId);
    if (!patientId) return validationError('患者IDが不正です');

    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);
    const keysetWhere = buildKeysetWhere(
      decodeKeysetCursor(PATIENT_PRESCRIPTION_CURSOR_KEYS, cursor),
    );

    const patient = await prisma.patient.findFirst({
      where: applyPatientAssignmentWhere(
        { id: patientId, org_id: ctx.orgId },
        { userId: ctx.userId, role: ctx.role },
      ),
      select: { id: true, name: true, name_kana: true },
    });
    if (!patient) return notFound('患者が見つかりません');
    const caseIds = await listAccessiblePatientCaseIds({
      db: prisma,
      orgId: ctx.orgId,
      patientId,
      accessContext: { userId: ctx.userId, role: ctx.role },
    });

    const intakes = await prisma.prescriptionIntake.findMany({
      where: {
        org_id: ctx.orgId,
        cycle: { patient_id: patientId, case_id: { in: caseIds } },
        ...(keysetWhere ?? {}),
      },
      orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        cycle_id: true,
        source_type: true,
        prescribed_date: true,
        prescriber_name: true,
        prescriber_institution: true,
        prescription_expiry_date: true,
        original_document_url: true,
        original_collected_at: true,
        original_collected_by: true,
        refill_remaining_count: true,
        refill_next_dispense_date: true,
        split_dispense_total: true,
        split_dispense_current: true,
        split_next_dispense_date: true,
        created_at: true,
        cycle: {
          select: { overall_status: true },
        },
        lines: {
          orderBy: { line_number: 'asc' },
          select: {
            id: true,
            line_number: true,
            drug_name: true,
            drug_code: true,
            dosage_form: true,
            dose: true,
            frequency: true,
            days: true,
            quantity: true,
            unit: true,
            is_generic: true,
            packaging_instructions: true,
            notes: true,
            route: true,
            dispensing_method: true,
            start_date: true,
            end_date: true,
          },
        },
      },
    });

    const hasMore = intakes.length > limit;
    const data = hasMore ? intakes.slice(0, limit) : intakes;
    const nextCursor = hasMore ? data[data.length - 1] : null;

    return success({
      patient,
      data,
      hasMore,
      nextCursor: nextCursor
        ? encodeKeysetCursor(PATIENT_PRESCRIPTION_CURSOR_KEYS, nextCursor)
        : undefined,
    });
  },
  {
    permission: 'canVisit',
    message: '患者処方履歴の閲覧権限がありません',
  },
);
