import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { success, validationError, notFound } from '@/lib/api/response';
import { validateOrgReferences } from '@/lib/api/org-reference';
import {
  isOperationalMemberRole,
  membershipFlagsForRole,
} from '@/lib/auth/member-roles';
import { updatePharmacistSchema } from '@/lib/validations/pharmacist';
import {
  disableCognitoUser,
  enableCognitoUser,
  resendCognitoInvite,
  updateCognitoUserProfile,
} from '@/server/services/cognito-admin';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '薬剤師管理の権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updatePharmacistSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { id } = await params;
  const pharmacist = await prisma.user.findFirst({
    where: {
      id,
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
      });
    } catch (error) {
      return validationError(
        error instanceof Error && error.message === 'COGNITO_NOT_CONFIGURED'
          ? 'Cognito 設定が不足しているため薬剤師情報を更新できません'
          : 'Cognito 上の薬剤師情報更新に失敗しました'
      );
    }

    const updated = await withOrgContext(ctx.orgId, async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: {
          name: data.name,
          name_kana: data.name_kana,
          phone: data.phone ?? null,
          max_daily_visits: isOperational ? (data.max_daily_visits ?? null) : null,
          max_weekly_visits: isOperational ? (data.max_weekly_visits ?? null) : null,
          max_travel_minutes: isOperational ? (data.max_travel_minutes ?? null) : null,
          can_accept_emergency: isOperational ? data.can_accept_emergency : false,
          visit_specialties: (isOperational ? data.visit_specialties : []) as Prisma.InputJsonValue,
          coverage_area: (isOperational ? data.coverage_area : []) as Prisma.InputJsonValue,
        },
      });

      await tx.membership.update({
        where: { id: membership.id },
        data: {
          site_id: data.site_id ?? null,
          role: data.role,
          can_dispense: data.can_dispense ?? roleFlags.can_dispense,
          can_audit_dispense:
            data.can_audit_dispense ?? roleFlags.can_audit_dispense,
          can_set: data.can_set ?? roleFlags.can_set,
          can_audit_set: data.can_audit_set ?? roleFlags.can_audit_set,
        },
      });

      await tx.auditLog.create({
        data: {
          org_id: ctx.orgId,
          actor_id: ctx.userId,
          action: 'pharmacist_updated',
          target_type: 'User',
          target_id: id,
          changes: {
            site_id: data.site_id,
            role: data.role,
            phone: data.phone ?? null,
            can_dispense: data.can_dispense ?? roleFlags.can_dispense,
            can_audit_dispense:
              data.can_audit_dispense ?? roleFlags.can_audit_dispense,
            can_set: data.can_set ?? roleFlags.can_set,
            can_audit_set: data.can_audit_set ?? roleFlags.can_audit_set,
          },
          ip_address: ctx.ipAddress,
          user_agent: ctx.userAgent,
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
          : '招待メールの再送に失敗しました'
      );
    }

    const updated = await withOrgContext(ctx.orgId, async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: {
          account_status:
            pharmacist.account_status === 'retired' ? 'retired' : 'invited',
          last_invited_at: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          org_id: ctx.orgId,
          actor_id: ctx.userId,
          action: 'pharmacist_invite_resent',
          target_type: 'User',
          target_id: id,
          ip_address: ctx.ipAddress,
          user_agent: ctx.userAgent,
        },
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
          : '薬剤師アカウントの再有効化に失敗しました'
      );
    }

    const updated = await withOrgContext(ctx.orgId, async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: {
          is_active: true,
          account_status: 'active',
          deactivated_at: null,
          deactivation_reason: null,
        },
      });

      await tx.membership.updateMany({
        where: {
          user_id: id,
          org_id: ctx.orgId,
        },
        data: {
          is_active: true,
        },
      });

      await tx.auditLog.create({
        data: {
          org_id: ctx.orgId,
          actor_id: ctx.userId,
          action: 'pharmacist_reactivated',
          target_type: 'User',
          target_id: id,
          ip_address: ctx.ipAddress,
          user_agent: ctx.userAgent,
        },
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
        : '薬剤師アカウントの停止に失敗しました'
    );
  }

  const updated = await withOrgContext(ctx.orgId, async (tx) => {
    const user = await tx.user.update({
      where: { id },
      data: {
        is_active: false,
        account_status: nextStatus,
        deactivated_at: new Date(),
        deactivation_reason: reason,
      },
    });

    await tx.membership.updateMany({
      where: {
        user_id: id,
        org_id: ctx.orgId,
      },
      data: {
        is_active: false,
      },
    });

    await tx.auditLog.create({
      data: {
        org_id: ctx.orgId,
        actor_id: ctx.userId,
        action:
          parsed.data.action === 'retire'
            ? 'pharmacist_retired'
            : 'pharmacist_suspended',
        target_type: 'User',
        target_id: id,
        changes: {
          reason,
        },
        ip_address: ctx.ipAddress,
        user_agent: ctx.userAgent,
      },
    });

    return user;
  });

  return success({ data: updated });
}
