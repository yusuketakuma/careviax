import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { adminGlobalSignOutCognitoUser } from '@/server/services/cognito-admin';
import {
  changePasswordWithAccessToken,
  confirmForgotPassword,
} from '@/server/services/cognito-auth';

type CredentialFlow = 'password_change' | 'password_reset';

type CredentialActor = {
  ipAddress?: string | null;
  userAgent?: string;
  requestId?: string;
  correlationId?: string;
};

type CredentialIntentUser = {
  id: string;
  org_id: string;
  email: string;
  cognito_username: string | null;
};

export class CredentialRevocationPendingError extends Error {
  constructor() {
    super('CREDENTIAL_REVOCATION_PENDING');
    this.name = 'CredentialRevocationPendingError';
  }
}

function isDefinitiveCredentialProviderRejection(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  return [
    'CodeMismatchException',
    'ExpiredCodeException',
    'InvalidParameterException',
    'InvalidPasswordException',
    'NotAuthorizedException',
    'PasswordHistoryPolicyViolationException',
    'UserNotFoundException',
  ].includes(name);
}

async function beginCredentialRevocation(user: CredentialIntentUser, flow: CredentialFlow) {
  const intentId = randomUUID();
  const started = await prisma.user.updateMany({
    where: { id: user.id, org_id: user.org_id, credential_revocation_id: null },
    data: {
      credential_revocation_id: intentId,
      credential_revocation_flow: flow,
      credential_revocation_pending_at: new Date(),
      credential_revocation_provider_completed_at: null,
      credential_revocation_local_completed_at: null,
    },
  });
  if (started.count !== 1) throw new CredentialRevocationPendingError();
  return intentId;
}

async function cancelCredentialRevocation(user: CredentialIntentUser, intentId: string) {
  await prisma.user.updateMany({
    where: {
      id: user.id,
      org_id: user.org_id,
      credential_revocation_id: intentId,
      credential_revocation_provider_completed_at: null,
      credential_revocation_local_completed_at: null,
    },
    data: {
      credential_revocation_id: null,
      credential_revocation_flow: null,
      credential_revocation_pending_at: null,
    },
  });
}

async function completeCredentialRevocation(args: {
  user: CredentialIntentUser;
  intentId: string;
  flow: CredentialFlow;
  actor: CredentialActor;
}) {
  await prisma.user.updateMany({
    where: {
      id: args.user.id,
      org_id: args.user.org_id,
      credential_revocation_id: args.intentId,
    },
    data: { credential_revocation_provider_completed_at: new Date() },
  });

  await withOrgContext(args.user.org_id, async (tx) => {
    const intent = await tx.user.findFirst({
      where: {
        id: args.user.id,
        org_id: args.user.org_id,
        credential_revocation_id: args.intentId,
      },
      select: { credential_revocation_local_completed_at: true },
    });
    if (!intent) throw new Error('CREDENTIAL_REVOCATION_INTENT_NOT_FOUND');

    if (!intent.credential_revocation_local_completed_at) {
      const completedAt = new Date();
      const completed = await tx.user.updateMany({
        where: {
          id: args.user.id,
          org_id: args.user.org_id,
          credential_revocation_id: args.intentId,
          credential_revocation_local_completed_at: null,
        },
        data: {
          session_version: { increment: 1 },
          credential_revocation_local_completed_at: completedAt,
        },
      });
      if (completed.count !== 1) throw new Error('CREDENTIAL_REVOCATION_LOCAL_CAS_FAILED');

      await createAuditLogEntry(
        tx,
        {
          orgId: args.user.org_id,
          userId: args.user.id,
          ipAddress: args.actor.ipAddress,
          userAgent: args.actor.userAgent,
          requestId: args.actor.requestId,
          correlationId: args.actor.correlationId,
        },
        {
          action: 'credential_changed_sessions_revoked',
          targetType: 'credential_revocation',
          targetId: args.intentId,
          changes: { flow: args.flow, scope: 'all_devices' },
        },
      );
    }
  });

  await adminGlobalSignOutCognitoUser(args.user.cognito_username ?? args.user.email);

  const cleared = await prisma.user.updateMany({
    where: {
      id: args.user.id,
      org_id: args.user.org_id,
      credential_revocation_id: args.intentId,
      credential_revocation_local_completed_at: { not: null },
    },
    data: {
      credential_revocation_id: null,
      credential_revocation_flow: null,
      credential_revocation_pending_at: null,
      credential_revocation_provider_completed_at: null,
      credential_revocation_local_completed_at: null,
    },
  });
  if (cleared.count !== 1) throw new Error('CREDENTIAL_REVOCATION_CLEAR_FAILED');
}

async function runCredentialMutation(args: {
  user: CredentialIntentUser;
  flow: CredentialFlow;
  actor: CredentialActor;
  mutateProvider: () => Promise<void>;
}) {
  const intentId = await beginCredentialRevocation(args.user, args.flow);
  try {
    await args.mutateProvider();
  } catch (error) {
    if (isDefinitiveCredentialProviderRejection(error)) {
      await cancelCredentialRevocation(args.user, intentId);
    }
    throw error;
  }
  await completeCredentialRevocation({ ...args, intentId });
}

export async function changePasswordAndRevokeSessions(args: {
  userId: string;
  accessToken: string;
  currentPassword: string;
  newPassword: string;
  actor: CredentialActor;
}) {
  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { id: true, org_id: true, email: true, cognito_username: true },
  });
  if (!user) throw new Error('LOCAL_USER_NOT_FOUND');
  await runCredentialMutation({
    user,
    flow: 'password_change',
    actor: args.actor,
    mutateProvider: () =>
      changePasswordWithAccessToken({
        accessToken: args.accessToken,
        currentPassword: args.currentPassword,
        newPassword: args.newPassword,
      }),
  });
}

export async function confirmForgotPasswordAndRevokeSessions(args: {
  email: string;
  code: string;
  newPassword: string;
  actor: CredentialActor;
}) {
  const normalizedEmail = args.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, org_id: true, email: true, cognito_username: true },
  });

  if (!user) {
    await confirmForgotPassword({
      email: normalizedEmail,
      code: args.code,
      newPassword: args.newPassword,
    });
    return;
  }

  await runCredentialMutation({
    user,
    flow: 'password_reset',
    actor: args.actor,
    mutateProvider: () =>
      confirmForgotPassword({
        email: normalizedEmail,
        code: args.code,
        newPassword: args.newPassword,
      }),
  });
}

export async function reconcileCredentialRevocationIntents(args: { orgId?: string } = {}) {
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
  const pendingUsers = await prisma.user.findMany({
    where: {
      ...(args.orgId ? { org_id: args.orgId } : {}),
      credential_revocation_id: { not: null },
      credential_revocation_pending_at: { lte: staleBefore },
    },
    select: {
      id: true,
      org_id: true,
      email: true,
      cognito_username: true,
      credential_revocation_id: true,
      credential_revocation_flow: true,
    },
    orderBy: [{ credential_revocation_pending_at: 'asc' }, { id: 'asc' }],
    take: 25,
  });

  let processedCount = 0;
  const errors: string[] = [];
  for (const user of pendingUsers) {
    const flow = user.credential_revocation_flow;
    const intentId = user.credential_revocation_id;
    if (!intentId || (flow !== 'password_change' && flow !== 'password_reset')) {
      errors.push('invalid_credential_revocation_intent');
      continue;
    }
    try {
      await completeCredentialRevocation({ user, intentId, flow, actor: {} });
      processedCount += 1;
    } catch {
      errors.push('credential_revocation_reconcile_failed');
    }
  }

  return { processedCount, scannedCount: pendingUsers.length, errors };
}
