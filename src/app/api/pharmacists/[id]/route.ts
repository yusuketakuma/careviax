import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { toPrismaJsonInput } from '@/lib/db/json';
import { internalError, success, validationError, notFound } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { isOperationalMemberRole, membershipFlagsForRole } from '@/lib/auth/member-roles';
import { phosRoleFromMemberRole } from '@/lib/auth/phos-role';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';
import { updatePharmacistSchema } from '@/lib/validations/pharmacist';
import {
  disableCognitoUser,
  enableCognitoUser,
  resendCognitoInvite,
  updateCognitoUserProfile,
} from '@/server/services/cognito-admin';

const ROUTE = '/api/pharmacists/[id]';
const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'EvalError',
  'URIError',
]);

function safeErrorName(err: unknown): string {
  if (!(err instanceof Error)) return 'Error';
  return SAFE_ERROR_NAMES.has(err.name) ? err.name : 'Error';
}

async function authenticatedPATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '薬剤師管理の権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updatePharmacistSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { id } = await params;
  const pharmacistId = normalizeRequiredRouteParam(id);
  if (!pharmacistId) return validationError('薬剤師IDが不正です');

  const pharmacist = await prisma.user.findFirst({
    where: {
      id: pharmacistId,
      org_id: ctx.orgId,
    },
    include: {
      memberships: {
        where: {
          org_id: ctx.orgId,
        },
        orderBy: { created_at: 'asc' },
        take: 1,
      },
    },
  });
  if (!pharmacist) return notFound('薬剤師が見つかりません');

  const membership = pharmacist.memberships[0];
  if (!membership) {
    return validationError('薬剤師の所属情報が見つかりません');
  }

  if (parsed.data.action === 'update') {
    const data = parsed.data;
    const refResult = await validateOrgReferences(ctx.orgId, {
      site_id: data.site_id,
    });
    if (!refResult.ok) return refResult.response;

    const isOperational = isOperationalMemberRole(data.role);
    const roleFlags = membershipFlagsForRole(data.role);

    try {
      await updateCognitoUserProfile({
        username: pharmacist.cognito_username ?? pharmacist.email,
        email: pharmacist.email,
        name: data.name,
        phone: data.phone,
        phosTenantId: ctx.orgId,
        phosRole: phosRoleFromMemberRole(data.role),
      });
    } catch (error) {
      return validationError(
        error instanceof Error && error.message === 'COGNITO_NOT_CONFIGURED'
          ? 'Cognito 設定が不足しているため薬剤師情報を更新できません'
          : 'Cognito 上の薬剤師情報更新に失敗しました',
      );
    }

    const updated = await withOrgContext(ctx.orgId, async (tx) => {
      const user = await tx.user.update({
        where: { id: pharmacistId },
        data: {
          name: data.name,
          name_kana: data.name_kana,
          phone: data.phone ?? null,
          max_daily_visits: isOperational ? (data.max_daily_visits ?? null) : null,
          max_weekly_visits: isOperational ? (data.max_weekly_visits ?? null) : null,
          max_travel_minutes: isOperational ? (data.max_travel_minutes ?? null) : null,
          can_accept_emergency: isOperational ? data.can_accept_emergency : false,
          visit_specialties: toPrismaJsonInput(isOperational ? data.visit_specialties : []),
          coverage_area: toPrismaJsonInput(isOperational ? data.coverage_area : []),
        },
      });

      await tx.membership.update({
        where: { id: membership.id },
        data: {
          site_id: data.site_id ?? null,
          role: data.role,
          can_dispense: data.can_dispense ?? roleFlags.can_dispense,
          can_audit_dispense: data.can_audit_dispense ?? roleFlags.can_audit_dispense,
          can_set: data.can_set ?? roleFlags.can_set,
          can_audit_set: data.can_audit_set ?? roleFlags.can_audit_set,
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'pharmacist_updated',
        targetType: 'User',
        targetId: pharmacistId,
        changes: {
          site_id: data.site_id,
          role: data.role,
          phone: data.phone ?? null,
          can_dispense: data.can_dispense ?? roleFlags.can_dispense,
          can_audit_dispense: data.can_audit_dispense ?? roleFlags.can_audit_dispense,
          can_set: data.can_set ?? roleFlags.can_set,
          can_audit_set: data.can_audit_set ?? roleFlags.can_audit_set,
        },
      });

      return user;
    });

    return success({ data: updated });
  }

  if (parsed.data.action === 'resend_invite') {
    try {
      await resendCognitoInvite(pharmacist.cognito_username ?? pharmacist.email);
    } catch (error) {
      return validationError(
        error instanceof Error && error.message === 'COGNITO_NOT_CONFIGURED'
          ? 'Cognito 設定が不足しているため招待を再送できません'
          : '招待メールの再送に失敗しました',
      );
    }

    const updated = await withOrgContext(ctx.orgId, async (tx) => {
      const user = await tx.user.update({
        where: { id: pharmacistId },
        data: {
          account_status: pharmacist.account_status === 'retired' ? 'retired' : 'invited',
          last_invited_at: new Date(),
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'pharmacist_invite_resent',
        targetType: 'User',
        targetId: pharmacistId,
      });

      return user;
    });

    return success({ data: updated });
  }

  if (parsed.data.action === 'reactivate') {
    try {
      await enableCognitoUser(pharmacist.cognito_username ?? pharmacist.email);
    } catch (error) {
      return validationError(
        error instanceof Error && error.message === 'COGNITO_NOT_CONFIGURED'
          ? 'Cognito 設定が不足しているため再有効化できません'
          : '薬剤師アカウントの再有効化に失敗しました',
      );
    }

    const updated = await withOrgContext(ctx.orgId, async (tx) => {
      const user = await tx.user.update({
        where: { id: pharmacistId },
        data: {
          is_active: true,
          account_status: 'active',
          deactivated_at: null,
          deactivation_reason: null,
        },
      });

      await tx.membership.updateMany({
        where: {
          user_id: pharmacistId,
          org_id: ctx.orgId,
        },
        data: {
          is_active: true,
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'pharmacist_reactivated',
        targetType: 'User',
        targetId: pharmacistId,
      });

      return user;
    });

    return success({ data: updated });
  }

  const nextStatus = parsed.data.action === 'retire' ? 'retired' : 'suspended';
  const reason = parsed.data.reason;

  try {
    await disableCognitoUser(pharmacist.cognito_username ?? pharmacist.email);
  } catch (error) {
    return validationError(
      error instanceof Error && error.message === 'COGNITO_NOT_CONFIGURED'
        ? 'Cognito 設定が不足しているため停止処理を実行できません'
        : '薬剤師アカウントの停止に失敗しました',
    );
  }

  const updated = await withOrgContext(ctx.orgId, async (tx) => {
    const user = await tx.user.update({
      where: { id: pharmacistId },
      data: {
        is_active: false,
        account_status: nextStatus,
        deactivated_at: new Date(),
        deactivation_reason: reason,
      },
    });

    await tx.membership.updateMany({
      where: {
        user_id: pharmacistId,
        org_id: ctx.orgId,
      },
      data: {
        is_active: false,
      },
    });

    await createAuditLogEntry(tx, ctx, {
      action: parsed.data.action === 'retire' ? 'pharmacist_retired' : 'pharmacist_suspended',
      targetType: 'User',
      targetId: pharmacistId,
      changes: {
        reason,
      },
    });

    return user;
  });

  return success({ data: updated });
}

export async function PATCH(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedPATCH(req, routeContext));
    } catch (err) {
      unstable_rethrow(err);
      logger.error('pharmacists_id_patch_unhandled_error', undefined, {
        event: 'pharmacists_id_patch_unhandled_error',
        route: ROUTE,
        method: req.method,
        status: 500,
        error_name: safeErrorName(err),
      });
      return withSensitiveNoStore(internalError());
    }
  });
}
