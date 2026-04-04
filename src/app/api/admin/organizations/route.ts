import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { success, validationError, conflict, error } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';
import { inviteCognitoUser } from '@/server/services/cognito-admin';

const createOrganizationSchema = z.object({
  // Organization
  name: z.string().min(1, '組織名は必須です'),
  corporate_number: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('有効なメールアドレスを入力してください').optional(),

  // Initial PharmacySite
  site_name: z.string().min(1, '薬局名は必須です'),
  site_address: z.string().min(1, '薬局住所は必須です'),
  site_phone: z.string().optional(),

  // Admin user invite
  admin_email: z.string().email('管理者メールアドレスが不正です'),
  admin_name: z.string().min(1, '管理者氏名は必須です'),
});

/**
 * POST /api/admin/organizations
 *
 * 新規組織（薬局法人）のプロビジョニング。
 * 組織 → 薬局サイト → Cognito ユーザー → User → Membership を一括作成する。
 * スーパーアドミン（org なし）または既存 org の owner のみ実行可。
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '組織プロビジョニングの権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createOrganizationSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const data = parsed.data;

  // Check duplicate corporate number
  if (data.corporate_number) {
    const existing = await prisma.organization.findUnique({
      where: { corporate_number: data.corporate_number },
      select: { id: true },
    });
    if (existing) {
      return conflict('同じ法人番号の組織が既に存在します');
    }
  }

  // Create Cognito user (invite)
  let cognitoSub: string;
  let cognitoUsername: string;
  try {
    const cognitoUser = await inviteCognitoUser({
      email: data.admin_email,
      name: data.admin_name,
    });
    cognitoSub = cognitoUser.sub;
    cognitoUsername = cognitoUser.username;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (message.includes('UsernameExistsException')) {
      return conflict('指定した管理者メールアドレスは既に登録されています');
    }
    return error('COGNITO_CREATE_FAILED', `Cognito ユーザー作成に失敗しました: ${message}`, 502);
  }

  // Transactionally create org, site, user, membership
  const result = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: data.name,
        corporate_number: data.corporate_number ?? null,
        address: data.address ?? null,
        phone: data.phone ?? null,
        email: data.email ?? null,
      },
      select: { id: true, name: true, created_at: true },
    });

    const site = await tx.pharmacySite.create({
      data: {
        org_id: org.id,
        name: data.site_name,
        address: data.site_address,
        phone: data.site_phone ?? null,
      },
      select: { id: true, name: true },
    });

    const user = await tx.user.create({
      data: {
        org_id: org.id,
        cognito_sub: cognitoSub,
        cognito_username: cognitoUsername,
        email: data.admin_email,
        name: data.admin_name,
        account_status: 'invited',
        invited_at: new Date(),
        invited_by: ctx.userId,
      },
      select: { id: true, email: true, name: true },
    });

    const membership = await tx.membership.create({
      data: {
        org_id: org.id,
        user_id: user.id,
        site_id: site.id,
        role: 'owner',
        can_dispense: true,
        can_audit_dispense: true,
        can_set: true,
        can_audit_set: true,
      },
      select: { id: true, role: true },
    });

    return { org, site, user, membership };
  });

  return success(
    {
      organization: result.org,
      site: result.site,
      admin_user: result.user,
      membership: result.membership,
    },
    201
  );
}
