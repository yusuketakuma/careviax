import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { createPatientSchema } from '@/lib/validations/patient';
import { prisma } from '@/lib/db/client';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const { cursor, limit } = parsePaginationParams(searchParams);
  const query = searchParams.get('q')?.trim() ?? '';

  const where = {
    org_id: req.orgId,
    ...(query
      ? {
          OR: [
            { name: { contains: query } },
            { name_kana: { contains: query } },
          ],
        }
      : {}),
  };

  const patients = await prisma.patient.findMany({
    where,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { name_kana: 'asc' },
    select: {
      id: true,
      name: true,
      name_kana: true,
      birth_date: true,
      gender: true,
      cases: {
        select: {
          id: true,
          status: true,
          updated_at: true,
        },
        orderBy: { updated_at: 'desc' },
        take: 1,
      },
    },
  });

  const hasMore = patients.length > limit;
  const data = hasMore ? patients.slice(0, limit) : patients;
  const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

  return success({ data, hasMore, nextCursor });
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createPatientSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { address, birth_date, ...rest } = parsed.data;

  const patient = await withOrgContext(req.orgId, async (tx) => {
    const newPatient = await tx.patient.create({
      data: {
        org_id: req.orgId,
        birth_date: new Date(birth_date),
        ...rest,
      },
    });

    if (address) {
      await tx.residence.create({
        data: {
          org_id: req.orgId,
          patient_id: newPatient.id,
          address,
          is_primary: true,
        },
      });
    }

    return newPatient;
  });

  return success(patient, 201);
});
