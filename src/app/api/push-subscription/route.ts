import { NextRequest } from 'next/server';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError } from '@/lib/api/response';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { z } from 'zod';

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

const httpsEndpointSchema = z.string().trim().url().refine(isHttpsUrl, {
  message: 'HTTPS endpoint is required',
});

const subscribeSchema = z.object({
  endpoint: httpsEndpointSchema,
  keys: z.object({
    p256dh: z.string().trim().min(1),
    auth: z.string().trim().min(1),
  }),
});

const unsubscribeSchema = z.object({
  endpoint: httpsEndpointSchema,
});

async function createPushSubscription(req: NextRequest, ctx: AuthContext) {
  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = subscribeSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { endpoint, keys } = parsed.data;

  await withOrgContext(
    ctx.orgId,
    (tx) =>
      tx.pushSubscription.upsert({
        where: { endpoint },
        create: {
          org_id: ctx.orgId,
          user_id: ctx.userId,
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
        },
        update: {
          org_id: ctx.orgId,
          user_id: ctx.userId,
          p256dh: keys.p256dh,
          auth: keys.auth,
        },
      }),
    { requestContext: ctx },
  );

  return success({ data: { ok: true } });
}

async function deletePushSubscription(req: NextRequest, ctx: AuthContext) {
  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = unsubscribeSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  await withOrgContext(
    ctx.orgId,
    (tx) =>
      tx.pushSubscription.deleteMany({
        where: {
          endpoint: parsed.data.endpoint,
          org_id: ctx.orgId,
          user_id: ctx.userId,
        },
      }),
    { requestContext: ctx },
  );

  return success({ data: { ok: true } });
}

export const POST = withAuthContext(createPushSubscription, {
  permission: 'canVisit',
  message: 'プッシュ通知の登録権限がありません',
});

export const DELETE = withAuthContext(deletePushSubscription, {
  permission: 'canVisit',
  message: 'プッシュ通知の削除権限がありません',
});
