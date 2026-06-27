import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { forbiddenResponse, internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { parseBoundedInteger } from '@/lib/api/pagination';
import {
  MANAGEABLE_MEMBER_ROLES,
  isOperationalMemberRole,
  membershipFlagsForRole,
} from '@/lib/auth/member-roles';
import { phosRoleFromMemberRole } from '@/lib/auth/phos-role';
import { prisma } from '@/lib/db/client';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { createPharmacistSchema } from '@/lib/validations/pharmacist';
import { deleteCognitoUser, inviteCognitoUser } from '@/server/services/cognito-admin';

const DEFAULT_PHARMACIST_LIST_LIMIT = 500;
const MAX_PHARMACIST_LIST_LIMIT = 500;

function dedupePharmacistsByUserId<T extends { id: string }>(items: T[]) {
  const uniqueItems = new Map<string, T>();
  for (const item of items) {
    if (!uniqueItems.has(item.id)) {
      uniqueItems.set(item.id, item);
    }
  }
  return Array.from(uniqueItems.values());
}

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const rawSiteId = searchParams.get('site_id');
    const siteId = rawSiteId?.trim() ?? null;
    if (searchParams.has('site_id') && !siteId) {
      return validationError('クエリパラメータが不正です', {
        site_id: ['site_id が不正です'],
      });
    }
    const includeCollaborators = searchParams.get('include_collaborators') === 'true';
    const limit = parseBoundedInteger(
      searchParams.get('limit'),
      DEFAULT_PHARMACIST_LIST_LIMIT,
      1,
      MAX_PHARMACIST_LIST_LIMIT,
    );
    if (includeCollaborators && ctx.role !== 'owner' && ctx.role !== 'admin') {
      return forbiddenResponse('スタッフ管理一覧の閲覧権限がありません');
    }
    // scheduled_date(@db.Date)比較用: ローカル今月の月初/翌月初を UTC 深夜で表す
    const [currentYear, currentMonth] = localDateKey().split('-').map(Number);
    const monthStart = utcDateFromLocalKey(
      `${currentYear}-${`${currentMonth}`.padStart(2, '0')}-01`,
    );
    const nextMonthStart = new Date(Date.UTC(currentYear, currentMonth, 1));

    const pharmacists = await prisma.membership.findMany({
      where: {
        org_id: ctx.orgId,
        ...(includeCollaborators ? {} : { is_active: true }),
        role: {
          in: includeCollaborators
            ? ['owner', ...MANAGEABLE_MEMBER_ROLES]
            : ['owner', 'admin', 'pharmacist', 'pharmacist_trainee'],
        },
        ...(siteId ? { site_id: siteId } : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            cognito_username: true,
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
            updated_at: true,
            max_daily_visits: true,
            max_weekly_visits: true,
            max_travel_minutes: true,
            can_accept_emergency: true,
            visit_specialties: true,
            coverage_area: true,
            credentials: {
              select: {
                certification_type: true,
              },
            },
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
      take: limit,
    });

    const pharmacistIds = pharmacists.map((membership) => membership.user.id);
    const monthlyVisitCounts =
      pharmacistIds.length === 0
        ? []
        : await prisma.visitSchedule.groupBy({
            by: ['pharmacist_id'],
            where: {
              org_id: ctx.orgId,
              pharmacist_id: { in: pharmacistIds },
              scheduled_date: {
                gte: monthStart,
                lt: nextMonthStart,
              },
              schedule_status: {
                not: 'cancelled',
              },
            },
            _count: {
              _all: true,
            },
          });
    const monthlyVisitCountByUserId = new Map(
      monthlyVisitCounts
        .filter((item) => item.pharmacist_id)
        .map((item) => [item.pharmacist_id as string, item._count._all]),
    );

    const data = pharmacists.map((membership) => ({
      id: membership.user.id,
      cognito_linked: Boolean(membership.user.cognito_username),
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
      last_active_at:
        membership.user.activated_at ??
        membership.user.last_invited_at ??
        membership.user.invited_at ??
        membership.user.updated_at,
      max_daily_visits: membership.user.max_daily_visits,
      max_weekly_visits: membership.user.max_weekly_visits,
      max_travel_minutes: membership.user.max_travel_minutes,
      can_accept_emergency: membership.user.can_accept_emergency,
      visit_specialties: membership.user.visit_specialties,
      coverage_area: membership.user.coverage_area,
      can_dispense: membership.can_dispense,
      can_audit_dispense: membership.can_audit_dispense,
      can_set: membership.can_set,
      can_audit_set: membership.can_audit_set,
      credential_types: membership.user.credentials.map(
        (credential) => credential.certification_type,
      ),
      monthly_visit_count: monthlyVisitCountByUserId.get(membership.user.id) ?? 0,
    }));

    return success({
      data: includeCollaborators ? dedupePharmacistsByUserId(data) : data,
    });
  },
  {
    permission: 'canVisit',
    message: '薬剤師一覧の閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createPharmacistSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const refResult = await validateOrgReferences(ctx.orgId, {
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
        phosTenantId: ctx.orgId,
        phosRole: phosRoleFromMemberRole(parsed.data.role),
      });
    } catch (error) {
      return validationError(
        error instanceof Error && error.message === 'COGNITO_NOT_CONFIGURED'
          ? 'Cognito 設定が不足しているため薬剤師を招待できません'
          : 'Cognito 招待の作成に失敗しました',
      );
    }

    const invitedAt = new Date();

    const isOperational = isOperationalMemberRole(parsed.data.role);

    try {
      const pharmacist = await withOrgContext(ctx.orgId, async (tx) => {
        const user = await tx.user.create({
          data: {
            org_id: ctx.orgId,
            cognito_sub: identity.sub,
            cognito_username: identity.username,
            email: parsed.data.email.toLowerCase(),
            name: parsed.data.name,
            name_kana: parsed.data.name_kana,
            phone: parsed.data.phone ?? null,
            max_daily_visits: isOperational ? (parsed.data.max_daily_visits ?? null) : null,
            max_weekly_visits: isOperational ? (parsed.data.max_weekly_visits ?? null) : null,
            max_travel_minutes: isOperational ? (parsed.data.max_travel_minutes ?? null) : null,
            can_accept_emergency: isOperational ? parsed.data.can_accept_emergency : false,
            visit_specialties: toPrismaJsonInput(
              isOperational ? parsed.data.visit_specialties : [],
            ),
            coverage_area: toPrismaJsonInput(isOperational ? parsed.data.coverage_area : []),
            account_status: 'invited',
            invited_at: invitedAt,
            invited_by: ctx.userId,
            last_invited_at: invitedAt,
          },
        });

        await tx.membership.create({
          data: {
            org_id: ctx.orgId,
            user_id: user.id,
            site_id: parsed.data.site_id ?? null,
            role: parsed.data.role,
            ...membershipFlagsForRole(parsed.data.role),
          },
        });

        await createAuditLogEntry(tx, ctx, {
          action: 'pharmacist_invited',
          targetType: 'User',
          targetId: user.id,
          changes: {
            site_id: parsed.data.site_id,
            role: parsed.data.role,
            email: user.email,
          },
        });

        return user;
      });

      return success(pharmacist, 201);
    } catch {
      try {
        await deleteCognitoUser(identity.username);
      } catch {
        return validationError(
          '薬剤師情報の保存に失敗しました。Cognito ユーザーの削除に失敗したため管理者確認が必要です',
        );
      }
      return validationError('薬剤師情報の保存に失敗しました');
    }
  },
  {
    permission: 'canAdmin',
    message: '薬剤師登録の権限がありません',
  },
);
