import { auth, getAuthAccessToken } from '@/lib/auth/config';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/client';
import { resolveLocalUserByIdentity } from '@/lib/auth/user-resolution';
import { externalError, success, unauthorized, validationError } from '@/lib/api/response';
import { updateCognitoUserProfile } from '@/server/services/cognito-admin';
import { getUserMfaState } from '@/server/services/cognito-auth';

async function resolveCurrentUser() {
  const session = await auth();
  if (!session?.user?.email && !session?.user?.cognitoSub) {
    return null;
  }

  const user =
    (session.user.id
      ? await prisma.user.findUnique({
          where: { id: session.user.id },
          include: {
            memberships: {
              where: { is_active: true },
              take: 1,
              include: {
                site: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        })
      : null) ??
    (await resolveLocalUserByIdentity({
      cognitoSub: session.user.cognitoSub,
      email: session.user.email,
    }).then((identity) =>
      identity
        ? prisma.user.findUnique({
            where: { id: identity.id },
            include: {
              memberships: {
                where: { is_active: true },
                take: 1,
                include: {
                  site: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
            },
          })
        : null
    ));

  if (!user) return null;

  return { user };
}

export async function GET(request: NextRequest) {
  const resolved = await resolveCurrentUser();
  if (!resolved) {
    return unauthorized();
  }

  const membership = resolved.user.memberships[0];
  let mfaEnabled = false;
  const accessToken = await getAuthAccessToken(request);

  if (accessToken) {
    try {
      const mfaState = await getUserMfaState(accessToken);
      mfaEnabled = mfaState.enabled;
    } catch (error) {
      if ((error as Error).message !== 'COGNITO_NOT_CONFIGURED') {
        console.warn('Failed to resolve Cognito MFA state', error);
      }
    }
  }

  return success({
    data: {
      id: resolved.user.id,
      email: resolved.user.email,
      name: resolved.user.name,
      name_kana: resolved.user.name_kana,
      phone: resolved.user.phone,
      orgId: resolved.user.org_id,
      defaultSiteId: resolved.user.default_site_id,
      currentRole: membership?.role ?? null,
      currentSiteName: membership?.site?.name ?? null,
      mfaEnabled,
      activatedAt: resolved.user.activated_at?.toISOString() ?? null,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const resolved = await resolveCurrentUser();
  if (!resolved) {
    return unauthorized();
  }

  const body = (await req.json().catch(() => null)) as
    | { name?: string; phone?: string | null }
    | null;
  if (!body) {
    return validationError('リクエストボディが不正です');
  }

  const name = body.name?.trim();
  const phone = body.phone?.trim() || null;

  if (!name) {
    return validationError('表示名は必須です');
  }

  const user = await prisma.user.update({
    where: { id: resolved.user.id },
    data: {
      name,
      phone,
    },
  });

  try {
    await updateCognitoUserProfile({
      username: user.cognito_username ?? user.email,
      email: user.email,
      name: user.name,
      phone: user.phone,
    });
  } catch (error) {
    if ((error as Error).message !== 'COGNITO_NOT_CONFIGURED') {
      return externalError(
        'EXTERNAL_COGNITO_UPDATE_FAILED',
        'プロフィールの同期に失敗しました',
        502
      );
    }
  }

  return success({
    data: {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
    },
  });
}
