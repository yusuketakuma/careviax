import { Prisma } from '@prisma/client';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { createPharmacistSchema } from '@/lib/validations/pharmacist';
import { inviteCognitoUser } from '@/server/services/cognito-admin';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const siteId = searchParams.get('site_id');

  const pharmacists = await prisma.membership.findMany({
    where: {
      org_id: req.orgId,
      is_active: true,
      role: {
        in: ['owner', 'admin', 'pharmacist', 'pharmacist_trainee'],
      },
      ...(siteId ? { site_id: siteId } : {}),
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          name_kana: true,
          email: true,
          phone: true,
          is_active: true,
          account_status: true,
          invited_at: true,
          last_invited_at: true,
          activated_at: true,
          deactivated_at: true,
          deactivation_reason: true,
          max_daily_visits: true,
          max_weekly_visits: true,
          max_travel_minutes: true,
          can_accept_emergency: true,
          visit_specialties: true,
          coverage_area: true,
        },
      },
      site: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: [{ user: { name_kana: 'asc' } }],
  });

  return success({
    data: pharmacists.map((membership) => ({
      id: membership.user.id,
      name: membership.user.name,
      name_kana: membership.user.name_kana,
      email: membership.user.email,
      phone: membership.user.phone,
      role: membership.role,
      site_id: membership.site_id,
      site_name: membership.site?.name ?? null,
      is_active: membership.user.is_active,
      account_status: membership.user.account_status,
      invited_at: membership.user.invited_at,
      last_invited_at: membership.user.last_invited_at,
      activated_at: membership.user.activated_at,
      deactivated_at: membership.user.deactivated_at,
      deactivation_reason: membership.user.deactivation_reason,
      max_daily_visits: membership.user.max_daily_visits,
      max_weekly_visits: membership.user.max_weekly_visits,
      max_travel_minutes: membership.user.max_travel_minutes,
      can_accept_emergency: membership.user.can_accept_emergency,
      visit_specialties: membership.user.visit_specialties,
      coverage_area: membership.user.coverage_area,
    })),
  });
}, {
  permission: 'canVisit',
  message: '薬剤師一覧の閲覧権限がありません',
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createPharmacistSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const refResult = await validateOrgReferences(req.orgId, {
    site_id: parsed.data.site_id,
  });
  if (!refResult.ok) return refResult.response;

  const existing = await prisma.user.findFirst({
    where: {
      email: parsed.data.email,
    },
    select: {
      id: true,
    },
  });
  if (existing) {
    return validationError('同じメールアドレスのユーザーが既に存在します');
  }

  let identity: Awaited<ReturnType<typeof inviteCognitoUser>>;
  try {
    identity = await inviteCognitoUser({
      email: parsed.data.email,
      name: parsed.data.name,
      phone: parsed.data.phone,
    });
  } catch (error) {
    return validationError(
      error instanceof Error && error.message === 'COGNITO_NOT_CONFIGURED'
        ? 'Cognito 設定が不足しているため薬剤師を招待できません'
        : 'Cognito 招待の作成に失敗しました'
    );
  }

  const invitedAt = new Date();

  const pharmacist = await withOrgContext(req.orgId, async (tx) => {
    const user = await tx.user.create({
      data: {
        org_id: req.orgId,
        cognito_sub: identity.sub,
        cognito_username: identity.username,
        email: parsed.data.email.toLowerCase(),
        name: parsed.data.name,
        name_kana: parsed.data.name_kana,
        phone: parsed.data.phone ?? null,
        max_daily_visits: parsed.data.max_daily_visits ?? null,
        max_weekly_visits: parsed.data.max_weekly_visits ?? null,
        max_travel_minutes: parsed.data.max_travel_minutes ?? null,
        can_accept_emergency: parsed.data.can_accept_emergency,
        visit_specialties: parsed.data.visit_specialties as Prisma.InputJsonValue,
        coverage_area: parsed.data.coverage_area as Prisma.InputJsonValue,
        account_status: 'invited',
        invited_at: invitedAt,
        invited_by: req.userId,
        last_invited_at: invitedAt,
      },
    });

    await tx.membership.create({
      data: {
        org_id: req.orgId,
        user_id: user.id,
        site_id: parsed.data.site_id,
        role: parsed.data.role,
        can_dispense: true,
        can_set: true,
      },
    });

    await tx.auditLog.create({
      data: {
        org_id: req.orgId,
        actor_id: req.userId,
        action: 'pharmacist_invited',
        target_type: 'User',
        target_id: user.id,
        changes: {
          site_id: parsed.data.site_id,
          role: parsed.data.role,
          email: user.email,
        },
        ip_address: req.ipAddress,
        user_agent: req.userAgent,
      },
    });

    return user;
  });

  return success(pharmacist, 201);
}, {
  permission: 'canAdmin',
  message: '薬剤師登録の権限がありません',
});
