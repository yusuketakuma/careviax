import { prisma } from '@/lib/db/client';

type LocalUserIdentity = {
  id: string;
  org_id: string;
  cognito_sub: string;
  email: string;
  name: string;
  phone: string | null;
  default_site_id: string | null;
  is_active: boolean;
  account_status: 'invited' | 'active' | 'suspended' | 'retired';
  activated_at: Date | null;
  session_version: number;
};

export async function resolveLocalUserByIdentity(args: {
  cognitoSub?: string | null;
  email?: string | null;
}): Promise<LocalUserIdentity | null> {
  const normalizedEmail = args.email?.trim().toLowerCase() ?? null;

  if (args.cognitoSub) {
    const user = await prisma.user.findUnique({
      where: { cognito_sub: args.cognitoSub },
      select: {
        id: true,
        org_id: true,
        cognito_sub: true,
        email: true,
        name: true,
        phone: true,
        default_site_id: true,
        is_active: true,
        account_status: true,
        activated_at: true,
        session_version: true,
      },
    });
    if (user) return user;
  }

  if (!normalizedEmail) return null;

  return prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      org_id: true,
      cognito_sub: true,
      email: true,
      name: true,
      phone: true,
      default_site_id: true,
      is_active: true,
      account_status: true,
      activated_at: true,
      session_version: true,
    },
  });
}

export async function markLocalUserActive(user: LocalUserIdentity) {
  if (
    user.account_status === 'suspended' ||
    user.account_status === 'retired'
  ) {
    return user;
  }

  if (user.account_status === 'active' && user.activated_at) {
    return user;
  }

  const activatedAt = user.activated_at ?? new Date();
  return prisma.user.update({
    where: { id: user.id },
    data: {
      is_active: true,
      account_status: 'active',
      activated_at: activatedAt,
      deactivated_at: null,
      deactivation_reason: null,
    },
    select: {
      id: true,
      org_id: true,
      cognito_sub: true,
      email: true,
      name: true,
      phone: true,
      default_site_id: true,
      is_active: true,
      account_status: true,
      activated_at: true,
      session_version: true,
    },
  });
}
