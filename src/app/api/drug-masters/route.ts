import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { success } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { prisma } from '@/lib/db/client';

export const GET = withAuthContext(
  async (req: NextRequest) => {
    const { searchParams } = new URL(req.url);
    const { limit, cursor } = parsePaginationParams(searchParams);
    const offset = cursor ? parseInt(cursor, 10) : 0;

    const q = searchParams.get('q') ?? '';
    const category = searchParams.get('category') ?? undefined;
    const genericOnly = searchParams.get('generic') === 'true';
    const narcoticOnly = searchParams.get('narcotic') === 'true';

    const where = {
      ...(q
        ? {
            OR: [
              { drug_name: { contains: q } },
              { drug_name_kana: { contains: q } },
              { yj_code: { startsWith: q } },
              { generic_name: { contains: q } },
            ],
          }
        : {}),
      ...(category ? { therapeutic_category: { startsWith: category } } : {}),
      ...(genericOnly ? { is_generic: true } : {}),
      ...(narcoticOnly ? { is_narcotic: true } : {}),
    };

    const [drugs, totalCount] = await Promise.all([
      prisma.drugMaster.findMany({
        where,
        orderBy: [{ drug_name_kana: 'asc' }, { drug_name: 'asc' }],
        skip: offset,
        take: limit + 1,
        select: {
          id: true,
          yj_code: true,
          receipt_code: true,
          jan_code: true,
          drug_name: true,
          drug_name_kana: true,
          generic_name: true,
          drug_price: true,
          unit: true,
          dosage_form: true,
          therapeutic_category: true,
          manufacturer: true,
          is_generic: true,
          is_narcotic: true,
          is_psychotropic: true,
          max_administration_days: true,
        },
      }),
      prisma.drugMaster.count({ where }),
    ]);

    const hasMore = drugs.length > limit;
    const data = hasMore ? drugs.slice(0, limit) : drugs;

    return success({
      data,
      hasMore,
      totalCount,
      nextCursor: hasMore ? String(offset + limit) : undefined,
    });
  }
);
