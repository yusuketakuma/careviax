import { unstable_rethrow } from 'next/navigation';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { internalError, success, validationError, notFound } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withOrgContext } from '@/lib/db/rls';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { updatePharmacistCredentialSchema } from '@/lib/validations/pharmacist-credential';

const authenticatedPATCH = withAuthContext<{ id: string }>(
  async (req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id } = await routeContext.params;
    const credentialId = normalizeRequiredRouteParam(id);
    if (!credentialId) return validationError('薬剤師認定情報IDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = updatePharmacistCredentialSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    if (parsed.data.user_id) {
      const refResult = await validateOrgReferences(ctx.orgId, {
        pharmacist_id: parsed.data.user_id,
      });
      if (!refResult.ok) return refResult.response;
    }

    const updatedResult = await withOrgContext(ctx.orgId, async (tx) => {
      const existing = await tx.pharmacistCredential.findFirst({
        where: { id: credentialId, org_id: ctx.orgId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
      if (!existing) return { kind: 'not_found' as const };

      const updated = await tx.pharmacistCredential.update({
        where: { id: credentialId },
        data: {
          ...(parsed.data.user_id !== undefined ? { user_id: parsed.data.user_id } : {}),
          ...(parsed.data.certification_type !== undefined
            ? { certification_type: parsed.data.certification_type }
            : {}),
          ...(parsed.data.certification_number !== undefined
            ? { certification_number: parsed.data.certification_number ?? null }
            : {}),
          ...(parsed.data.issued_date !== undefined
            ? { issued_date: parsed.data.issued_date ? new Date(parsed.data.issued_date) : null }
            : {}),
          ...(parsed.data.expiry_date !== undefined
            ? { expiry_date: parsed.data.expiry_date ? new Date(parsed.data.expiry_date) : null }
            : {}),
          ...(parsed.data.tenure_years !== undefined
            ? { tenure_years: parsed.data.tenure_years }
            : {}),
          ...(parsed.data.weekly_work_hours !== undefined
            ? { weekly_work_hours: parsed.data.weekly_work_hours }
            : {}),
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'pharmacist_credential_updated',
        targetType: 'PharmacistCredential',
        targetId: updated.id,
        changes: {
          previous_user_id: existing.user.id,
          user_id: updated.user.id,
          certification_type: updated.certification_type,
          expiry_date: updated.expiry_date?.toISOString() ?? null,
        },
      });

      return { kind: 'updated' as const, credential: updated };
    });
    if (updatedResult.kind === 'not_found') return notFound('薬剤師認定情報が見つかりません');
    const updated = updatedResult.credential;

    return success({
      data: {
        id: updated.id,
        user_id: updated.user.id,
        user_name: updated.user.name,
        certification_type: updated.certification_type,
        certification_number: updated.certification_number,
        issued_date: updated.issued_date?.toISOString() ?? null,
        expiry_date: updated.expiry_date?.toISOString() ?? null,
        tenure_years: updated.tenure_years,
        weekly_work_hours: updated.weekly_work_hours,
        consented_patients: [],
      },
    });
  },
  {
    permission: 'canAdmin',
    message: '薬剤師認定情報の更新権限がありません',
  },
);

const authenticatedDELETE = withAuthContext<{ id: string }>(
  async (_req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id } = await routeContext.params;
    const credentialId = normalizeRequiredRouteParam(id);
    if (!credentialId) return validationError('薬剤師認定情報IDが不正です');

    const deleted = await withOrgContext(ctx.orgId, async (tx) => {
      const existing = await tx.pharmacistCredential.findFirst({
        where: { id: credentialId, org_id: ctx.orgId },
        select: {
          id: true,
          user_id: true,
          certification_type: true,
          expiry_date: true,
        },
      });
      if (!existing) return false;

      await tx.pharmacistCredential.delete({
        where: { id: credentialId },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'pharmacist_credential_deleted',
        targetType: 'PharmacistCredential',
        targetId: existing.id,
        changes: {
          user_id: existing.user_id,
          certification_type: existing.certification_type,
          expiry_date: existing.expiry_date?.toISOString() ?? null,
        },
      });

      return true;
    });
    if (!deleted) return notFound('薬剤師認定情報が見つかりません');

    return success({ message: '薬剤師認定情報を削除しました' });
  },
  {
    permission: 'canAdmin',
    message: '薬剤師認定情報の更新権限がありません',
  },
);

export const PATCH: typeof authenticatedPATCH = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPATCH(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};

export const DELETE: typeof authenticatedDELETE = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedDELETE(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
