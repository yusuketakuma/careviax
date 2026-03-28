import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { buildSearchFilter, buildSort } from '@/lib/api/search';
import { parseSearchParams } from '@/lib/api/validation';
import { createPatientSchema } from '@/lib/validations/patient';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

const patientListQuerySchema = z.object({
  q: z.string().trim().optional(),
  cursor: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  sort: z.enum(['name_kana', 'name', 'created_at']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const parsed = parseSearchParams(patientListQuerySchema, searchParams);
  if (!parsed.ok) {
    return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
  }
  const cursor = parsed.data.cursor;
  const limit = parsed.data.limit ?? 50;
  const query = parsed.data.q ?? '';
  const primarySort = buildSort(
    parsed.data.sort,
    parsed.data.order,
    ['name_kana', 'name', 'created_at'],
    'name_kana'
  );

  const where = {
    org_id: req.orgId,
    ...buildSearchFilter(query, ['name', 'name_kana']),
  };

  const patients = await prisma.patient.findMany({
    where,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy:
      parsed.data.sort === 'name'
        ? [primarySort ?? { name_kana: 'asc' }, { name_kana: 'asc' }]
        : [primarySort ?? { name_kana: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      name_kana: true,
      birth_date: true,
      gender: true,
      phone: true,
      residences: {
        where: { is_primary: true },
        take: 1,
        select: {
          address: true,
        },
      },
      conditions: {
        where: { is_active: true },
        orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
        take: 3,
        select: {
          id: true,
          condition_type: true,
          name: true,
        },
      },
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
}, {
  permission: 'canVisit',
  message: '患者情報の閲覧権限がありません',
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createPatientSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { address, birth_date, ...rest } = parsed.data;
  const normalizedContacts =
    rest.contacts?.map((contact) => ({
      name: contact.name,
      relation: contact.relation,
      phone: contact.phone || null,
      email: contact.email || null,
      fax: contact.fax || null,
      organization_name: contact.organization_name || null,
      department: contact.department || null,
      address: contact.address || null,
      is_primary: contact.is_primary,
      is_emergency_contact: contact.is_emergency_contact,
      notes: contact.notes || null,
    })) ?? [];
  const normalizedConditions =
    rest.conditions?.map((condition) => ({
      condition_type: condition.condition_type,
      name: condition.name,
      is_primary: condition.is_primary,
      is_active: condition.is_active,
      noted_at: condition.noted_at ? new Date(condition.noted_at) : null,
      notes: condition.notes || null,
    })) ?? [];

  const patient = await withOrgContext(req.orgId, async (tx) => {
    const newPatient = await tx.patient.create({
      data: {
        org_id: req.orgId,
        birth_date: new Date(birth_date),
        name: rest.name,
        name_kana: rest.name_kana,
        gender: rest.gender,
        phone: rest.phone || null,
        medical_insurance_number: rest.medical_insurance_number || null,
        care_insurance_number: rest.care_insurance_number || null,
        allergy_info: rest.allergy_info ?? undefined,
        notes: rest.notes || null,
      },
    });

    if (address) {
      await tx.residence.create({
        data: {
          org_id: req.orgId,
          patient_id: newPatient.id,
          address,
          building_id: rest.building_id || null,
          unit_name: rest.unit_name || null,
          is_primary: true,
        },
      });
    }

    if (normalizedContacts.length > 0) {
      await tx.contactParty.createMany({
        data: normalizedContacts.map((contact) => ({
          org_id: req.orgId,
          patient_id: newPatient.id,
          ...contact,
        })),
      });
    }

    if (normalizedConditions.length > 0) {
      await tx.patientCondition.createMany({
        data: normalizedConditions.map((condition) => ({
          org_id: req.orgId,
          patient_id: newPatient.id,
          ...condition,
        })),
      });
    }

    return newPatient;
  });

  return success(patient, 201);
}, {
  permission: 'canVisit',
  message: '患者情報の作成権限がありません',
});
