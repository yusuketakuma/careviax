import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { buildCursorPage, parseBoundedInteger } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { internalError, success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { createPrescriberInstitutionSchema } from '@/lib/validations/prescriber-institution';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';

const DEFAULT_PRESCRIBER_INSTITUTION_SEARCH_LIMIT = 500;
const MAX_PRESCRIBER_INSTITUTION_SEARCH_LIMIT = 500;

function toResponse(item: {
  id: string;
  name: string;
  institution_code: string | null;
  address: string | null;
  phone: string | null;
  fax: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  _count?: {
    prescription_intakes: number;
  };
  prescription_intakes?: Array<{
    prescribed_date: Date;
  }>;
}) {
  return {
    ...item,
    prescription_count: item._count?.prescription_intakes ?? 0,
    last_prescribed_at: item.prescription_intakes?.[0]?.prescribed_date.toISOString() ?? null,
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
      DEFAULT_PRESCRIBER_INSTITUTION_SEARCH_LIMIT,
      1,
      MAX_PRESCRIBER_INSTITUTION_SEARCH_LIMIT,
    );

    const items = await prisma.prescriberInstitution.findMany({
      where: {
        org_id: ctx.orgId,
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: 'insensitive' } },
                { institution_code: { contains: query, mode: 'insensitive' } },
                { address: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        _count: {
          select: {
            prescription_intakes: true,
          },
        },
        prescription_intakes: {
          orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }],
          take: 1,
          select: {
            prescribed_date: true,
          },
        },
      },
      orderBy: [{ name: 'asc' }],
      ...(query ? { take: limit + 1 } : {}),
    });

    if (!query) {
      return success({ data: items.map(toResponse) });
    }

    const page = buildCursorPage(items, limit, (item) => item.id);

    return success({
      data: page.data.map(toResponse),
      meta: { limit, has_more: page.hasMore },
    });
  },
  {
    permission: 'canReport',
    message: '医療機関マスターの閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createPrescriberInstitutionSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const created = await withOrgContext(ctx.orgId, async (tx) => {
      return tx.prescriberInstitution.create({
        data: {
          org_id: ctx.orgId,
          name: parsed.data.name,
          institution_code: parsed.data.institution_code || null,
          address: parsed.data.address || null,
          phone: parsed.data.phone || null,
          fax: parsed.data.fax || null,
          notes: parsed.data.notes || null,
        },
      });
    });

    return success({ data: toResponse(created) }, 201);
  },
  {
    permission: 'canAdmin',
    message: '医療機関マスターの更新権限がありません',
  },
);
