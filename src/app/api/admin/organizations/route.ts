import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { success, validationError, conflict, error, forbidden } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';
import { deleteCognitoUser, inviteCognitoUser } from '@/server/services/cognito-admin';
import { optionalPhoneNumberSchema } from '@/lib/validations/phone';
import { phosRoleFromMemberRole } from '@/lib/auth/phos-role';
import { logger } from '@/lib/utils/logger';

const ADMIN_ORGANIZATIONS_ROUTE = '/api/admin/organizations';
const COGNITO_CREATE_FAILED_MESSAGE = 'Cognito ユーザー作成に失敗しました';

function trimStringOrUndefined(value: unknown) {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const optionalTrimmedStringSchema = z.preprocess(
  trimStringOrUndefined,
  z.string().min(1).optional(),
);

const optionalOrganizationEmailSchema = z.preprocess(
  trimStringOrUndefined,
  z.string().email('有効なメールアドレスを入力してください').optional(),
);

const createOrganizationSchema = z.object({
  // Organization
  name: z.string().trim().min(1, '組織名は必須です'),
  corporate_number: optionalTrimmedStringSchema,
  address: optionalTrimmedStringSchema,
  phone: optionalPhoneNumberSchema,
  email: optionalOrganizationEmailSchema,

  // Initial PharmacySite
  site_name: z.string().trim().min(1, '薬局名は必須です'),
  site_address: z.string().trim().min(1, '薬局住所は必須です'),
  site_phone: optionalPhoneNumberSchema,

  // Admin user invite
  admin_email: z.string().trim().email('管理者メールアドレスが不正です'),
  admin_name: z.string().trim().min(1, '管理者氏名は必須です'),
});

type ProvisionedTenantState = {
  org: { id: string };
  site: { id: string };
  user: { id: string };
};

function logOrganizationProvisioningError(input: {
  event: string;
  operation: string;
  error: unknown;
}) {
  logger.error(
    {
      event: input.event,
      route: ADMIN_ORGANIZATIONS_ROUTE,
      method: 'POST',
      operation: input.operation,
      entityType: 'organization_provisioning',
    },
    input.error,
  );
}

async function cleanupProvisionedTenant(records: ProvisionedTenantState) {
  await prisma.$transaction(async (tx) => {
    await tx.membership.deleteMany({
      where: { user_id: records.user.id, org_id: records.org.id },
    });
    await tx.user.delete({
      where: { id: records.user.id },
    });
    await tx.pharmacySite.delete({
      where: { id: records.site.id },
    });
    await tx.organization.delete({
      where: { id: records.org.id },
    });
  });
}

/**
 * POST /api/admin/organizations
 *
 * 新規組織（薬局法人）のプロビジョニング。
 * 組織 → 薬局サイト → Cognito ユーザー → User → Membership を一括作成する。
 * 既存 org の owner のみ実行可。
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '組織プロビジョニングの権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;
  if (ctx.role !== 'owner') {
    return forbidden('組織プロビジョニングは owner のみ実行できます');
  }

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = createOrganizationSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const data = parsed.data;

  // Check duplicate corporate number / admin email before creating any tenant state.
  if (data.corporate_number) {
    const existing = await prisma.organization.findUnique({
      where: { corporate_number: data.corporate_number },
      select: { id: true },
    });
    if (existing) {
      return conflict('同じ法人番号の組織が既に存在します');
    }
  }
  const adminEmail = data.admin_email.trim().toLowerCase();
  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
    select: { id: true },
  });
  if (existingAdmin) {
    return conflict('指定した管理者メールアドレスは既に登録されています');
  }

  // Step 1: Create tenant records in a transaction.
  // If the Cognito invite fails, run a compensating transaction to avoid
  // returning an error while leaving a partial tenant behind.
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
        // Temporary placeholder; will be updated after Cognito user is created
        cognito_sub: `pending_${org.id}`,
        email: adminEmail,
        name: data.admin_name,
        account_status: 'pending_cognito' as const,
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

  // Step 2: Create Cognito user after DB transaction succeeded.
  let cognitoSub: string;
  let cognitoUsername: string;
  try {
    const cognitoUser = await inviteCognitoUser({
      email: adminEmail,
      name: data.admin_name,
      phosTenantId: result.org.id,
      phosRole: phosRoleFromMemberRole('owner'),
    });
    cognitoSub = cognitoUser.sub;
    cognitoUsername = cognitoUser.username;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const isUsernameExists = message.includes('UsernameExistsException');
    let cleanupFailed = false;
    try {
      await cleanupProvisionedTenant(result);
    } catch (cleanupError) {
      cleanupFailed = true;
      logOrganizationProvisioningError({
        event: 'admin_organizations.cognito_invite_cleanup_failed',
        operation: 'cleanup_provisioned_tenant_after_cognito_invite',
        error: cleanupError,
      });
    }
    if (cleanupFailed) {
      if (!isUsernameExists) {
        logOrganizationProvisioningError({
          event: 'admin_organizations.cognito_invite_failed',
          operation: 'invite_cognito_user',
          error: cause,
        });
      }
      return error(
        'ORGANIZATION_PROVISIONING_PARTIAL_FAILURE',
        '組織作成中に外部連携が失敗し、ロールバックにも失敗しました。手動確認が必要です。',
        500,
      );
    }
    if (isUsernameExists) {
      return conflict('指定した管理者メールアドレスは既に登録されています');
    }
    logOrganizationProvisioningError({
      event: 'admin_organizations.cognito_invite_failed',
      operation: 'invite_cognito_user',
      error: cause,
    });
    return error('COGNITO_CREATE_FAILED', COGNITO_CREATE_FAILED_MESSAGE, 502);
  }

  // Step 3: Update user record with Cognito sub and set status to invited
  try {
    await prisma.user.update({
      where: { id: result.user.id },
      data: {
        cognito_sub: cognitoSub,
        cognito_username: cognitoUsername,
        account_status: 'invited',
      },
    });
  } catch (cause) {
    let cleanupFailed = false;
    try {
      await deleteCognitoUser(cognitoUsername);
    } catch (cleanupError) {
      cleanupFailed = true;
      logOrganizationProvisioningError({
        event: 'admin_organizations.cognito_cleanup_failed',
        operation: 'delete_cognito_user_after_final_update',
        error: cleanupError,
      });
    }
    try {
      await cleanupProvisionedTenant(result);
    } catch (cleanupError) {
      cleanupFailed = true;
      logOrganizationProvisioningError({
        event: 'admin_organizations.tenant_cleanup_failed',
        operation: 'cleanup_provisioned_tenant_after_final_update',
        error: cleanupError,
      });
    }
    logOrganizationProvisioningError({
      event: 'admin_organizations.final_user_update_failed',
      operation: 'update_local_user_after_cognito_invite',
      error: cause,
    });
    if (cleanupFailed) {
      return error(
        'ORGANIZATION_PROVISIONING_PARTIAL_FAILURE',
        '組織作成中に最終更新が失敗し、ロールバックにも失敗しました。手動確認が必要です。',
        500,
      );
    }
    return error(
      'ORGANIZATION_PROVISIONING_FAILED',
      '組織作成中に最終更新が失敗しました。変更をロールバックしました。',
      500,
    );
  }

  return success(
    {
      organization: result.org,
      site: result.site,
      admin_user: result.user,
      membership: result.membership,
    },
    201,
  );
}
