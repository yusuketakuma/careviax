import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { parseBoundedInteger } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { assertFacilityReference } from '@/lib/patient/facility-reference';
import {
  createExternalProfessionalSchema,
  contactMethodSchema,
  professionTypeSchema,
} from '@/lib/validations/external-professional';

const DEFAULT_EXTERNAL_PROFESSIONAL_SEARCH_LIMIT = 500;
const MAX_EXTERNAL_PROFESSIONAL_SEARCH_LIMIT = 500;

function parseOptionalEnumFilter<T>(
  searchParams: URLSearchParams,
  fieldName: string,
  schema: { safeParse: (value: string) => { success: true; data: T } | { success: false } },
) {
  const rawValue = searchParams.get(fieldName);
  if (rawValue === null) return { ok: true as const, data: undefined };

  const trimmedValue = rawValue.trim();
  if (!trimmedValue) return { ok: true as const, data: undefined };

  const parsed = schema.safeParse(trimmedValue);
  if (!parsed.success) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', { [fieldName]: ['不正な値です'] }),
    };
  }

  return { ok: true as const, data: parsed.data };
}

function parseFacilityIdFilter(searchParams: URLSearchParams) {
  const rawValue = searchParams.get('facility_id');
  if (rawValue === null) return { ok: true as const, data: undefined };

  const trimmedValue = rawValue.trim();
  if (!trimmedValue) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', { facility_id: ['施設IDが不正です'] }),
    };
  }

  return { ok: true as const, data: trimmedValue };
}

function toResponse(item: {
  id: string;
  profession_type: string;
  name: string;
  facility_id: string | null;
  facility?: {
    name: string;
  } | null;
  organization_name: string | null;
  department: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
  preferred_contact_method: string | null;
  preferred_contact_time: string | null;
  last_contacted_at: Date | null;
  last_success_channel: string | null;
  address: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  _count?: {
    care_team_links: number;
  };
}) {
  return {
    ...item,
    facility_name: item.facility?.name ?? null,
    patient_count: item._count?.care_team_links ?? 0,
    last_contacted_at: item.last_contacted_at?.toISOString() ?? null,
    created_at: item.created_at.toISOString(),
    updated_at: item.updated_at.toISOString(),
  };
}

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    const queryParam = req.nextUrl.searchParams.get('q')?.trim();
    const query = queryParam && queryParam.length > 0 ? queryParam : undefined;
    const limit = parseBoundedInteger(
      req.nextUrl.searchParams.get('limit'),
      DEFAULT_EXTERNAL_PROFESSIONAL_SEARCH_LIMIT,
      1,
      MAX_EXTERNAL_PROFESSIONAL_SEARCH_LIMIT,
    );
    const parsedFacilityId = parseFacilityIdFilter(req.nextUrl.searchParams);
    if (!parsedFacilityId.ok) return parsedFacilityId.response;

    const parsedProfessionType = parseOptionalEnumFilter(
      req.nextUrl.searchParams,
      'profession_type',
      professionTypeSchema,
    );
    if (!parsedProfessionType.ok) return parsedProfessionType.response;

    const parsedPreferredContactMethod = parseOptionalEnumFilter(
      req.nextUrl.searchParams,
      'preferred_contact_method',
      contactMethodSchema,
    );
    if (!parsedPreferredContactMethod.ok) return parsedPreferredContactMethod.response;

    const items = await prisma.externalProfessional.findMany({
      where: {
        org_id: ctx.orgId,
        ...(parsedProfessionType.data ? { profession_type: parsedProfessionType.data } : {}),
        ...(parsedFacilityId.data ? { facility_id: parsedFacilityId.data } : {}),
        ...(parsedPreferredContactMethod.data
          ? { preferred_contact_method: parsedPreferredContactMethod.data }
          : {}),
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: 'insensitive' } },
                { organization_name: { contains: query, mode: 'insensitive' } },
                { facility: { name: { contains: query, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: {
        facility: {
          select: {
            name: true,
          },
        },
        _count: {
          select: {
            care_team_links: true,
          },
        },
      },
      orderBy: [{ profession_type: 'asc' }, { name: 'asc' }],
      ...(query ? { take: limit + 1 } : {}),
    });

    if (!query) {
      return success({ data: items.map(toResponse) });
    }

    return success({
      data: items.slice(0, limit).map(toResponse),
      meta: { limit, has_more: items.length > limit },
    });
  },
  {
    permission: 'canReport',
    message: '他職種マスターの閲覧権限がありません',
  },
);

export async function GET(
  req: NextRequest,
  routeContext: { params: Promise<Record<string, string>> },
) {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch {
    return withSensitiveNoStore(internalError());
  }
}

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createExternalProfessionalSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const created = await withOrgContext(ctx.orgId, async (tx) => {
      await assertFacilityReference(tx, ctx.orgId, parsed.data.facility_id || null);

      return tx.externalProfessional.create({
        data: {
          org_id: ctx.orgId,
          profession_type: parsed.data.profession_type,
          name: parsed.data.name,
          facility_id: parsed.data.facility_id || null,
          organization_name: parsed.data.organization_name || null,
          department: parsed.data.department || null,
          phone: parsed.data.phone || null,
          email: parsed.data.email || null,
          fax: parsed.data.fax || null,
          preferred_contact_method: parsed.data.preferred_contact_method || null,
          preferred_contact_time: parsed.data.preferred_contact_time || null,
          address: parsed.data.address || null,
          notes: parsed.data.notes || null,
        },
        include: {
          facility: {
            select: {
              name: true,
            },
          },
        },
      });
    });

    return success({ data: toResponse(created) }, 201);
  },
  {
    permission: 'canAdmin',
    message: '他職種マスターの更新権限がありません',
  },
);
