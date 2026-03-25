import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth/config';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, forbidden } from '@/lib/api/response';
import { updatePrescriptionIntakeSchema } from '@/lib/validations/prescription';
import { prisma } from '@/lib/db/client';

async function getAuthContext(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return null;
  return { userId: session.user.id, orgId };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return forbidden('認証が必要です');

  const { id } = await params;

  const intake = await prisma.prescriptionIntake.findFirst({
    where: { id, org_id: ctx.orgId },
    include: {
      lines: {
        orderBy: { line_number: 'asc' },
      },
      cycle: {
        select: {
          id: true,
          overall_status: true,
          patient_id: true,
          case_id: true,
        },
      },
    },
  });

  if (!intake) return notFound('処方箋が見つかりません');

  return success(intake);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return forbidden('認証が必要です');

  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updatePrescriptionIntakeSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.prescriptionIntake.findFirst({
    where: { id, org_id: ctx.orgId },
  });
  if (!existing) return notFound('処方箋が見つかりません');

  const { refill_next_dispense_date, ...rest } = parsed.data;

  const intake = await withOrgContext(ctx.orgId, async (tx) => {
    return tx.prescriptionIntake.update({
      where: { id },
      data: {
        ...rest,
        ...(refill_next_dispense_date
          ? { refill_next_dispense_date: new Date(refill_next_dispense_date) }
          : {}),
      },
      include: {
        lines: { orderBy: { line_number: 'asc' } },
      },
    });
  });

  return success(intake);
}
