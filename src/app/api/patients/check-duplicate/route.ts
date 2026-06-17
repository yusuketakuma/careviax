import { withAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { patientGenderSchema } from '@/lib/validations/patient';
import {
  findPatientDuplicateCandidates,
  parsePatientDuplicateBirthDate,
} from '@/lib/patient/duplicate-detection';

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

    const birthDate = parsePatientDuplicateBirthDate(dateOfBirth);
    if (!birthDate) {
      return validationError('date_of_birth の形式が不正です');
    }

    const duplicates = await findPatientDuplicateCandidates(prisma, {
      orgId: ctx.orgId,
      name,
      birthDate,
      gender: parsedGender.data,
      access: {
        userId: ctx.userId,
        role: ctx.role,
      },
    });

    return success({ duplicates });
  },
  {
    permission: 'canVisit',
    message: '患者情報の閲覧権限がありません',
  },
);
