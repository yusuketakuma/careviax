import { withAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { createPrescriberInstitutionSchema } from '@/lib/validations/prescriber-institution';

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

export const GET = withAuthContext(
  async (req, ctx) => {
    const query = req.nextUrl.searchParams.get('q')?.trim();

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
    });

    return success({ data: items.map(toResponse) });
  },
  {
    permission: 'canReport',
    message: '医療機関マスターの閲覧権限がありません',
  },
);

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
