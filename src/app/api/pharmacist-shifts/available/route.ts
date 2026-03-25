import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');
  const timeFrom = searchParams.get('time_from');
  const timeTo = searchParams.get('time_to');

  if (!date) return validationError('dateパラメータは必須です');

  const targetDate = new Date(date);

  const shifts = await prisma.pharmacistShift.findMany({
    where: {
      org_id: req.orgId,
      date: targetDate,
      available: true,
      ...(timeFrom
        ? {
            OR: [
              { available_from: null },
              { available_from: { lte: new Date(`1970-01-01T${timeFrom}`) } },
            ],
          }
        : {}),
      ...(timeTo
        ? {
            OR: [
              { available_to: null },
              { available_to: { gte: new Date(`1970-01-01T${timeTo}`) } },
            ],
          }
        : {}),
    },
    include: {
      user: { select: { id: true, name: true, name_kana: true } },
    },
    orderBy: { user: { name_kana: 'asc' } },
  });

  return success({ data: shifts });
});
