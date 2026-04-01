import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import {
  MANAGEABLE_MEMBER_ROLES,
  isOperationalMemberRole,
  membershipFlagsForRole,
  roleRequiresSite,
} from '@/lib/auth/member-roles';
import { inviteCognitoUser } from '@/server/services/cognito-admin';

const importRowSchema = z.object({
  name: z.string().trim().min(1, '氏名は必須です'),
  name_kana: z.string().trim().min(1, 'フリガナは必須です'),
  email: z.string().trim().email('メールアドレス形式が不正です'),
  phone: z.string().trim().optional().nullable(),
  role: z.enum(MANAGEABLE_MEMBER_ROLES),
  site_name: z.string().trim().optional().nullable(),
  certification_type: z.string().trim().optional().nullable(),
  certification_number: z.string().trim().optional().nullable(),
  issued_date: z.string().date().optional().nullable(),
  expiry_date: z.string().date().optional().nullable(),
  tenure_years: z.coerce.number().min(0).max(80).optional().nullable(),
  weekly_work_hours: z.coerce.number().min(0).max(168).optional().nullable(),
});

const importSchema = z.object({
  rows: z.array(importRowSchema).min(1, 'CSV 行がありません').max(300, '一度に 300 行までです'),
});

export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: 'スタッフ一括取込の権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const sites = await prisma.pharmacySite.findMany({
    where: { org_id: ctx.orgId },
    select: { id: true, name: true },
  });
  const siteIdByName = new Map(
    sites.map((site) => [site.name.trim().toLowerCase(), site.id])
  );

  const results: Array<{
    email: string;
    name: string;
    status: 'created' | 'failed';
    message: string;
  }> = [];

  for (const row of parsed.data.rows) {
    const siteId = row.site_name
      ? siteIdByName.get(row.site_name.trim().toLowerCase()) ?? null
      : null;

    if (roleRequiresSite(row.role) && !siteId) {
      results.push({
        email: row.email,
        name: row.name,
        status: 'failed',
        message: row.site_name
          ? `店舗 "${row.site_name}" が見つかりません`
          : '所属店舗が必須です',
      });
      continue;
    }

    const existing = await prisma.user.findFirst({
      where: {
        email: row.email.toLowerCase(),
      },
      select: { id: true },
    });
    if (existing) {
      results.push({
        email: row.email,
        name: row.name,
        status: 'failed',
        message: '同じメールアドレスのユーザーが既に存在します',
      });
      continue;
    }

    let identity: Awaited<ReturnType<typeof inviteCognitoUser>>;
    try {
      identity = await inviteCognitoUser({
        email: row.email,
        name: row.name,
        phone: row.phone ?? undefined,
      });
    } catch (error) {
      results.push({
        email: row.email,
        name: row.name,
        status: 'failed',
        message:
          error instanceof Error && error.message === 'COGNITO_NOT_CONFIGURED'
            ? 'Cognito 設定が不足しています'
            : 'Cognito 招待に失敗しました',
      });
      continue;
    }

    const invitedAt = new Date();
    const isOperational = isOperationalMemberRole(row.role);

    await withOrgContext(ctx.orgId, async (tx) => {
      const user = await tx.user.create({
        data: {
          org_id: ctx.orgId,
          cognito_sub: identity.sub,
          cognito_username: identity.username,
          email: row.email.toLowerCase(),
          name: row.name,
          name_kana: row.name_kana,
          phone: row.phone ?? null,
          max_daily_visits: null,
          max_weekly_visits: null,
          max_travel_minutes: null,
          can_accept_emergency: isOperational,
          visit_specialties: [] as Prisma.InputJsonValue,
          coverage_area: [] as Prisma.InputJsonValue,
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
          site_id: siteId,
          role: row.role,
          ...membershipFlagsForRole(row.role),
        },
      });

      if (row.certification_type) {
        await tx.pharmacistCredential.create({
          data: {
            org_id: ctx.orgId,
            user_id: user.id,
            certification_type: row.certification_type,
            certification_number: row.certification_number || null,
            issued_date: row.issued_date ? new Date(row.issued_date) : null,
            expiry_date: row.expiry_date ? new Date(row.expiry_date) : null,
            tenure_years: row.tenure_years ?? null,
            weekly_work_hours: row.weekly_work_hours ?? null,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          org_id: ctx.orgId,
          actor_id: ctx.userId,
          action: 'pharmacist_imported',
          target_type: 'User',
          target_id: user.id,
          changes: {
            role: row.role,
            site_id: siteId,
            certification_type: row.certification_type ?? null,
          },
          ip_address: ctx.ipAddress,
          user_agent: ctx.userAgent,
        },
      });
    });

    results.push({
      email: row.email,
      name: row.name,
      status: 'created',
      message: '招待を作成しました',
    });
  }

  return success({
    data: {
      created_count: results.filter((result) => result.status === 'created').length,
      failed_count: results.filter((result) => result.status === 'failed').length,
      results,
    },
  });
}
