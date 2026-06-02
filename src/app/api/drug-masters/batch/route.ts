import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

const batchSchema = z.object({
  yj_codes: z.array(z.string().trim().min(1)).min(1).max(200),
});

export const POST = withAuthContext(async (req: NextRequest) => {
  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = batchSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const yjCodes = Array.from(new Set(parsed.data.yj_codes));
  const drugs = await prisma.drugMaster.findMany({
    where: { yj_code: { in: yjCodes } },
    select: {
      yj_code: true,
      drug_name: true,
      dosage_form: true,
      drug_price: true,
      unit: true,
      is_generic: true,
      is_narcotic: true,
      is_psychotropic: true,
      is_high_risk: true,
      is_lasa_risk: true,
      tall_man_name: true,
      lasa_group_key: true,
      max_administration_days: true,
      therapeutic_category: true,
    },
  });

  const byCode = Object.fromEntries(drugs.map((d) => [d.yj_code, d]));

  return success(byCode);
});
