import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { Gender } from '@prisma/client';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get('name')?.trim();
  const dateOfBirth = searchParams.get('date_of_birth')?.trim();
  const gender = searchParams.get('gender')?.trim();

  if (!name || !dateOfBirth || !gender) {
    return validationError('name, date_of_birth, gender は必須です');
  }

  // Validate date format
  const birthDate = new Date(dateOfBirth);
  if (isNaN(birthDate.getTime())) {
    return validationError('date_of_birth の形式が不正です');
  }

  // Search for duplicates: name partial match (case-insensitive), birth_date exact, gender exact
  const duplicates = await prisma.patient.findMany({
    where: {
      org_id: req.orgId,
      name: { contains: name, mode: 'insensitive' },
      birth_date: birthDate,
      ...(Object.values(Gender).includes(gender as Gender) ? { gender: gender as Gender } : {}),
    },
    select: {
      id: true,
      name: true,
      name_kana: true,
      birth_date: true,
      gender: true,
    },
    take: 10,
  });

  return success({ duplicates });
}, {
  permission: 'canVisit',
  message: '患者情報の閲覧権限がありません',
});
