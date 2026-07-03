import 'server-only';
import type { NextRequest, NextResponse } from 'next/server';
import { PlatformOperatorRole, PlatformOperatorStatus } from '@prisma/client';
import { auth } from '@/lib/auth/config';
import { prisma } from '@/lib/db/client';
import { resolveLocalUserByIdentity } from '@/lib/auth/user-resolution';
import { forbiddenResponse, unauthorized } from '@/lib/api/response';
import { getClientIp } from '@/lib/api/request-ip';
import { logger } from '@/lib/utils/logger';

/**
 * Resolved platform-operator identity for a request. This is a PLATFORM-level
 * actor (system developer/administrator) and is intentionally distinct from a
 * tenant {@link import('@/lib/auth/context').AuthContext} — an operator is not
 * an org member and carries no org_id of their own.
 */
export type PlatformOperatorContext = {
  operatorId: string;
  userId: string;
  /** Operator's login email — used for step-up re-authentication. */
  email: string;
  role: PlatformOperatorRole;
  ipAddress?: string;
  userAgent?: string;
};

/** Least-privilege tier ordering. Higher rank ⊇ lower rank capabilities. */
const ROLE_RANK: Record<PlatformOperatorRole, number> = {
  [PlatformOperatorRole.platform_support]: 1,
  [PlatformOperatorRole.platform_admin]: 2,
  [PlatformOperatorRole.platform_owner]: 3,
};

/** True when `role` is at least the `min` tier. */
export function platformRoleAtLeast(
  role: PlatformOperatorRole,
  min: PlatformOperatorRole,
): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

type AuthSession = NonNullable<Awaited<ReturnType<typeof auth>>>;

async function resolveUserId(session: AuthSession): Promise<string | null> {
  const sessionUserId = session.user?.id?.trim();
  if (sessionUserId) {
    const direct = await prisma.user.findUnique({
      where: { id: sessionUserId },
      select: { id: true },
    });
    if (direct?.id) return direct.id;
  }
  const resolved = await resolveLocalUserByIdentity({
    cognitoSub: session.user?.cognitoSub,
    email: session.user?.email,
  });
  return resolved?.id ?? null;
}

/**
 * Resolves the platform-operator identity for the current session, or null when
 * the caller is not an active platform operator. Does NOT enforce (returns null
 * rather than a response) so callers can decide how to react.
 */
export async function resolvePlatformOperator(
  request: NextRequest,
): Promise<PlatformOperatorContext | null> {
  const session = await auth();
  if (!session) return null;
  const userId = await resolveUserId(session);
  if (!userId) return null;

  const [operator, user] = await Promise.all([
    prisma.platformOperator.findUnique({
      where: { user_id: userId },
      select: { id: true, role: true, status: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
  ]);
  if (!operator || operator.status !== PlatformOperatorStatus.active) return null;
  if (!user?.email) return null;

  return {
    operatorId: operator.id,
    userId,
    email: user.email,
    role: operator.role,
    ipAddress: getClientIp(request) ?? undefined,
    userAgent: request.headers.get('user-agent') ?? undefined,
  };
}

/**
 * Enforcing variant. Returns `{ operator }` for an active operator meeting the
 * optional minimum role, or `{ response }` (401 for non-operators, 403 for an
 * operator lacking the required tier) mirroring the requireAuthContext idiom.
 */
export async function requirePlatformOperator(
  request: NextRequest,
  options?: { minRole?: PlatformOperatorRole },
): Promise<{ operator: PlatformOperatorContext } | { response: NextResponse }> {
  const operator = await resolvePlatformOperator(request);
  if (!operator) {
    logger.warn({ event: 'platform_operator_denied', route: request.nextUrl?.pathname });
    return { response: await unauthorized() };
  }
  if (options?.minRole && !platformRoleAtLeast(operator.role, options.minRole)) {
    logger.warn({
      event: 'platform_operator_insufficient_role',
      actorId: operator.userId,
      code: operator.role,
      targetId: options.minRole,
    });
    return { response: await forbiddenResponse('この操作には上位の運営者権限が必要です') };
  }
  return { operator };
}
