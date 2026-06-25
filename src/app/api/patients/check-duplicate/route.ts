import { withAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { patientGenderSchema } from '@/lib/validations/patient';
import {
  type PatientDuplicateCandidate,
  findPatientDuplicateCandidates,
  parsePatientDuplicateBirthDate,
} from '@/lib/patient/duplicate-detection';

type DuplicateCheckQueryName = 'name' | 'date_of_birth' | 'gender';

function readRequiredDuplicateCheckQuery(
  searchParams: URLSearchParams,
  name: DuplicateCheckQueryName,
  messages: { required: string; invalid: string; maxLength?: number },
) {
  const values = searchParams.getAll(name);
  if (values.length !== 1) {
    return {
      ok: false as const,
      fieldErrors: {
        [name]: values.length === 0 ? [messages.required] : [`${name} は1つだけ指定してください`],
      },
    };
  }

  const rawValue = values[0];
  const value = rawValue.trim();
  if (value.length === 0) {
    return {
      ok: false as const,
      fieldErrors: { [name]: [messages.required] },
    };
  }
  if (rawValue !== value || value.length > (messages.maxLength ?? 100)) {
    return {
      ok: false as const,
      fieldErrors: { [name]: [messages.invalid] },
    };
  }

  return { ok: true as const, value };
}

function toDuplicateCheckCandidate(candidate: PatientDuplicateCandidate) {
  return {
    id: candidate.id,
    name: candidate.name,
    birth_date: candidate.birth_date,
    gender: candidate.gender,
  };
}

function parseDuplicateCheckQuery(searchParams: URLSearchParams) {
  const nameResult = readRequiredDuplicateCheckQuery(searchParams, 'name', {
    required: 'name は必須です',
    invalid: 'name の形式が不正です',
  });
  if (!nameResult.ok) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', nameResult.fieldErrors),
    };
  }

  const birthDateResult = readRequiredDuplicateCheckQuery(searchParams, 'date_of_birth', {
    required: 'date_of_birth は必須です',
    invalid: 'date_of_birth の形式が不正です',
    maxLength: 10,
  });
  if (!birthDateResult.ok) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', birthDateResult.fieldErrors),
    };
  }

  const genderResult = readRequiredDuplicateCheckQuery(searchParams, 'gender', {
    required: 'gender は必須です',
    invalid: 'gender の値が不正です',
    maxLength: 20,
  });
  if (!genderResult.ok) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', genderResult.fieldErrors),
    };
  }

  const parsedGender = patientGenderSchema.safeParse(genderResult.value);
  if (!parsedGender.success) {
    return {
      ok: false as const,
      response: validationError('gender の値が不正です', {
        gender: ['対応していない性別です'],
      }),
    };
  }

  const birthDate = parsePatientDuplicateBirthDate(birthDateResult.value);
  if (!birthDate) {
    return {
      ok: false as const,
      response: validationError('date_of_birth の形式が不正です', {
        date_of_birth: ['YYYY-MM-DD 形式で指定してください'],
      }),
    };
  }

  return {
    ok: true as const,
    name: nameResult.value,
    birthDate,
    gender: parsedGender.data,
  };
}

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const query = parseDuplicateCheckQuery(searchParams);
    if (!query.ok) return query.response;

    const duplicates = await findPatientDuplicateCandidates(prisma, {
      orgId: ctx.orgId,
      name: query.name,
      birthDate: query.birthDate,
      gender: query.gender,
      access: {
        userId: ctx.userId,
        role: ctx.role,
      },
    });

    return success({ duplicates: duplicates.map(toDuplicateCheckCandidate) });
  },
  {
    permission: 'canVisit',
    message: '患者情報の閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) =>
  withSensitiveNoStore(await authenticatedGET(req, routeContext));
