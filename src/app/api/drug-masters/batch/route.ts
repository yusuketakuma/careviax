import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

const batchSchema = z.object({
  yj_codes: z.array(z.string()).min(1).max(200),
});

export const POST = withAuthContext(
  async (req: NextRequest) => {
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = batchSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const drugs = await prisma.drugMaster.findMany({
      where: { yj_code: { in: parsed.data.yj_codes } },
      select: {
        yj_code: true,
        drug_name: true,
        dosage_form: true,
        drug_price: true,
        unit: true,
        is_generic: true,
        is_narcotic: true,
        is_psychotropic: true,
        max_administration_days: true,
        therapeutic_category: true,
      },
    });

    const byCode = Object.fromEntries(drugs.map((d) => [d.yj_code, d]));

    return success(byCode);
  }
);
