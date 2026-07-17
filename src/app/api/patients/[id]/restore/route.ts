import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, notFound, conflict, validationError } from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';

type RestorePatientResult =
  | { patient: { id: string; archived_at: Date | null; archived_by: string | null } }
  | { error: 'not_found' | 'not_archived' };

async function restorePatient(
  _req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  const result = await withOrgContext(
    ctx.orgId,
    async (tx): Promise<RestorePatientResult> => {
      const existing = await tx.patient.findFirst({
        where: { id, org_id: ctx.orgId },
        select: { id: true, archived_at: true },
      });
      if (!existing) return { error: 'not_found' };
      if (!existing.archived_at) return { error: 'not_archived' };

      const patient = await tx.patient.update({
        where: { id },
        data: {
          archived_at: null,
          archived_by: null,
        },
        select: { id: true, archived_at: true, archived_by: true },
      });
      return { patient };
    },
    { requestContext: ctx },
  );

  if ('error' in result) {
    return result.error === 'not_archived'
      ? conflict('患者はアーカイブされていません')
      : notFound('患者が見つかりません');
  }

  return success({ data: result.patient });
}

export const PATCH = withAuthContext(restorePatient, {
  permission: 'canAdmin',
  message: '患者の復元権限がありません',
});
