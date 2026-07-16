import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, notFound, conflict, validationError } from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { acquirePatientWriteStateLock } from '@/server/services/patient-write-guard';

type ArchivePatientResult =
  | { patient: { id: string; archived_at: Date | null; archived_by: string | null } }
  | { error: 'not_found' | 'already_archived' };

async function archivePatient(
  _req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  const result = await withOrgContext(
    ctx.orgId,
    async (tx): Promise<ArchivePatientResult> => {
      await acquirePatientWriteStateLock(tx, ctx.orgId, id);
      const existing = await tx.patient.findFirst({
        where: { id, org_id: ctx.orgId },
        select: { id: true, archived_at: true },
      });
      if (!existing) return { error: 'not_found' };
      if (existing.archived_at) return { error: 'already_archived' };

      const patient = await tx.patient.update({
        where: { id },
        data: {
          archived_at: new Date(),
          archived_by: ctx.userId,
        },
        select: { id: true, archived_at: true, archived_by: true },
      });
      return { patient };
    },
    { requestContext: ctx },
  );

  if ('error' in result) {
    return result.error === 'already_archived'
      ? conflict('患者は既にアーカイブ済みです')
      : notFound('患者が見つかりません');
  }

  return success({ data: result.patient });
}

export const PATCH = withAuthContext(archivePatient, {
  permission: 'canAdmin',
  message: '患者のアーカイブ権限がありません',
});
