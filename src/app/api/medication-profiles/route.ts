import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { createMedicationProfileSchema } from '@/lib/validations/medication';
import { prisma } from '@/lib/db/client';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const { cursor, limit } = parsePaginationParams(searchParams);

  const patientId = searchParams.get('patient_id') ?? undefined;
  const isCurrentParam = searchParams.get('is_current');
  const isCurrent =
    isCurrentParam === 'true' ? true : isCurrentParam === 'false' ? false : undefined;

  const where = {
    org_id: req.orgId,
    ...(patientId ? { patient_id: patientId } : {}),
    ...(isCurrent !== undefined ? { is_current: isCurrent } : {}),
  };

  const profiles = await prisma.medicationProfile.findMany({
    where,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      org_id: true,
      patient_id: true,
      drug_master_id: true,
      drug_name: true,
      dose: true,
      frequency: true,
      start_date: true,
      end_date: true,
      prescriber: true,
      is_current: true,
      source: true,
      created_at: true,
      updated_at: true,
    },
  });

  const hasMore = profiles.length > limit;
  const data = hasMore ? profiles.slice(0, limit) : profiles;
  const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

  return success({ data, hasMore, nextCursor });
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createMedicationProfileSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { patient_id, start_date, end_date, ...rest } = parsed.data;

  const profile = await withOrgContext(req.orgId, async (tx) => {
    return tx.medicationProfile.create({
      data: {
        org_id: req.orgId,
        patient_id,
        ...(start_date ? { start_date: new Date(start_date) } : {}),
        ...(end_date ? { end_date: new Date(end_date) } : {}),
        ...rest,
      },
    });
  });

  return success({ data: profile }, 201);
});
