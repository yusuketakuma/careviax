import { withAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { patientGenderSchema } from '@/lib/validations/patient';

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const name = searchParams.get('name')?.trim();
    const dateOfBirth = searchParams.get('date_of_birth')?.trim();
    const gender = searchParams.get('gender')?.trim();

    if (!name || !dateOfBirth || !gender) {
      return validationError('name, date_of_birth, gender は必須です');
    }

    const parsedGender = patientGenderSchema.safeParse(gender);
    if (!parsedGender.success) {
      return validationError('gender の値が不正です', {
        gender: ['対応していない性別です'],
      });
    }

    // Validate date format
    const birthDate = new Date(dateOfBirth);
    if (isNaN(birthDate.getTime())) {
      return validationError('date_of_birth の形式が不正です');
    }

    // Search for duplicates: name partial match (case-insensitive), birth_date exact, gender exact
    const duplicates = await prisma.patient.findMany({
      where: {
        org_id: ctx.orgId,
        name: { contains: name, mode: 'insensitive' },
        birth_date: birthDate,
        gender: parsedGender.data,
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
  },
  {
    permission: 'canVisit',
    message: '患者情報の閲覧権限がありません',
  },
);
