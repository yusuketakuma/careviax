import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { createPrescriptionIntakeSchema } from '@/lib/validations/prescription';
import { prisma } from '@/lib/db/client';
import { addDays } from 'date-fns';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const { cursor, limit } = parsePaginationParams(searchParams);

  const status = searchParams.get('status') ?? undefined;
  const sourceType = searchParams.get('source_type') ?? undefined;

  const where = {
    org_id: req.orgId,
    ...(sourceType ? { source_type: sourceType as never } : {}),
    ...(status
      ? {
          cycle: {
            overall_status: status as never,
          },
        }
      : {}),
  };

  const intakes = await prisma.prescriptionIntake.findMany({
    where,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      cycle_id: true,
      source_type: true,
      prescribed_date: true,
      prescriber_name: true,
      prescriber_institution: true,
      prescription_expiry_date: true,
      refill_remaining_count: true,
      refill_next_dispense_date: true,
      created_at: true,
      cycle: {
        select: {
          overall_status: true,
          patient_id: true,
        },
      },
    },
  });

  const hasMore = intakes.length > limit;
  const data = hasMore ? intakes.slice(0, limit) : intakes;
  const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

  return success({ data, hasMore, nextCursor });
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createPrescriptionIntakeSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const {
    cycle_id,
    source_type,
    prescribed_date,
    refill_remaining_count,
    refill_next_dispense_date,
    lines,
    ...rest
  } = parsed.data;

  const prescribedDateObj = new Date(prescribed_date);

  // 有効期限チェック（発行日+4日）
  const expiryDate = addDays(prescribedDateObj, 4);
  const now = new Date();
  if (expiryDate < now) {
    return validationError('処方箋の有効期限が切れています（発行日から4日以内が有効です）');
  }

  const result = await withOrgContext(req.orgId, async (tx) => {
    // Verify cycle belongs to this org
    const cycle = await tx.medicationCycle.findFirst({
      where: { id: cycle_id, org_id: req.orgId },
      select: { id: true, patient_id: true },
    });
    if (!cycle) return null;

    // Create PrescriptionIntake
    const intake = await tx.prescriptionIntake.create({
      data: {
        org_id: req.orgId,
        cycle_id,
        source_type,
        prescribed_date: prescribedDateObj,
        prescription_expiry_date: expiryDate,
        ...(source_type === 'refill' && refill_remaining_count !== undefined
          ? { refill_remaining_count }
          : {}),
        ...(source_type === 'refill' && refill_next_dispense_date
          ? { refill_next_dispense_date: new Date(refill_next_dispense_date) }
          : {}),
        ...rest,
        lines: {
          create: lines.map((line) => ({
            org_id: req.orgId,
            ...line,
          })),
        },
      },
      include: { lines: true },
    });

    // Update MedicationCycle status to intake_received
    await tx.medicationCycle.update({
      where: { id: cycle_id },
      data: { overall_status: 'intake_received' },
    });

    return intake;
  });

  if (!result) {
    return validationError('指定されたサイクルが見つかりません');
  }

  return success(result, 201);
});
