import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { success, notFound } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { prisma } from '@/lib/db/client';

export const GET = withAuthContext(
  async (
    req: NextRequest,
    ctx,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    const { id: patientId } = await params;
    const { searchParams } = new URL(req.url);
    const { limit, offset } = parsePaginationParams(searchParams);

    const patient = await prisma.patient.findFirst({
      where: { id: patientId, org_id: ctx.orgId },
      select: { id: true, name: true, name_kana: true },
    });
    if (!patient) return notFound('患者が見つかりません');

    const intakes = await prisma.prescriptionIntake.findMany({
      where: {
        org_id: ctx.orgId,
        cycle: { patient_id: patientId },
      },
      orderBy: { prescribed_date: 'desc' },
      skip: offset,
      take: limit + 1,
      select: {
        id: true,
        cycle_id: true,
        source_type: true,
        prescribed_date: true,
        prescriber_name: true,
        prescriber_institution: true,
        prescription_expiry_date: true,
        refill_remaining_count: true,
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

    return success({
      patient,
      data,
      hasMore,
      nextCursor: hasMore ? String(offset + limit) : undefined,
    });
  }
);
