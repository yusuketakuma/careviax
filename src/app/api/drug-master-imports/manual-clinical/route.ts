import { NextRequest } from 'next/server';
import { success, validationError } from '@/lib/api/response';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { readOptionalJsonObjectRequestBody } from '@/lib/api/request-body';
import { withOrgContext } from '@/lib/db/rls';
import {
  importManualClinicalRules,
  manualClinicalRuleBundleSchema,
} from '@/server/services/drug-master-import/manual';
import { invalidateDrugMasterSearchCache } from '@/server/services/drug-master-search-cache';
import { invalidateDrugMasterDetailCache } from '@/server/services/drug-master-detail-cache';
import { projectDrugMasterImportLogMetadata } from '../import-log-response';

async function authenticatedPOST(req: NextRequest, ctx: AuthContext) {
  const payload = await readOptionalJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = manualClinicalRuleBundleSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const result = await withOrgContext(
    ctx.orgId,
    (tx) => importManualClinicalRules(tx, parsed.data),
    {
      requestContext: ctx,
      maxWaitMs: 10_000,
      timeoutMs: 30_000,
    },
  );
  invalidateDrugMasterSearchCache();
  invalidateDrugMasterDetailCache();
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
        ...projectDrugMasterImportLogMetadata(result.log),
      },
    },
    201,
  );
}

export const POST = withAuthContext(authenticatedPOST, {
  permission: 'canAdmin',
  message: '医薬品マスター取込は管理者のみ実行できます',
});
