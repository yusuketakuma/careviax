import { NextRequest } from 'next/server';
import { forbidden, success, validationError } from '@/lib/api/response';
import { isAdmin, withAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import {
  importManualClinicalRules,
  manualClinicalRuleBundleSchema,
} from '@/server/services/drug-master-import/manual';

export const POST = withAuthContext(async (req: NextRequest, authCtx) => {
  if (!isAdmin(authCtx.role)) {
    return forbidden('医薬品マスター取込は管理者のみ実行できます');
  }

  const body = await req.json().catch(() => ({}));
  const parsed = manualClinicalRuleBundleSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const result = await importManualClinicalRules(prisma, parsed.data);
  return success(
    {
      data: {
        logId: result.log.id,
        status: result.log.status,
        importedCount: result.importedCount,
        pimCount: result.pimCount,
        highRiskCount: result.highRiskCount,
        renalCount: result.renalCount,
        safetyOverrideCount: result.safetyOverrideCount,
      },
    },
    201,
  );
});
