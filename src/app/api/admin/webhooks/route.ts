import { withAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { NextResponse } from 'next/server';
import { withOrgContext } from '@/lib/db/rls';
import { z } from 'zod';
import { isAllowedWebhookUrl, WEBHOOK_EVENT_TYPES } from '@/server/services/outbound-webhook';
import { encryptWebhookSecret } from '@/server/services/webhook-secret-encryption';
import { randomBytes } from 'node:crypto';

const createWebhookSchema = z.object({
  url: z.string().url('有効なURLを入力してください'),
  events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1, 'イベントを1件以上選択してください'),
});

function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}

export const GET = withAuthContext(
  async (_req, ctx) => {
    const registrations = await withOrgContext(ctx.orgId, async (tx) => {
      return tx.webhookRegistration.findMany({
        where: { org_id: ctx.orgId },
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          url: true,
          events: true,
          is_active: true,
          created_at: true,
          updated_at: true,
          // Exclude secret from list response
        },
      });
    });

    return NextResponse.json({ data: registrations });
  },
  { permission: 'canAdmin', message: 'Webhook 設定の閲覧権限がありません' },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) {
      return NextResponse.json({ error: 'リクエストボディが不正です' }, { status: 400 });
    }

    const parsed = createWebhookSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: '入力値が不正です', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { url, events } = parsed.data;

    if (!(await isAllowedWebhookUrl(url))) {
      return NextResponse.json(
        { error: 'WebhookのURLはHTTPS公開エンドポイントである必要があります' },
        { status: 400 },
      );
    }

    const secret = generateWebhookSecret();
    let encryptedSecret;
    try {
      encryptedSecret = await encryptWebhookSecret(secret);
    } catch {
      return NextResponse.json(
        { error: 'Webhook secret encryption key is not configured' },
        { status: 503 },
      );
    }

    const registration = await withOrgContext(ctx.orgId, async (tx) => {
      const created = await tx.webhookRegistration.create({
        data: {
          org_id: ctx.orgId,
          url,
          secret: null,
          ...encryptedSecret,
          events,
        },
        select: {
          id: true,
          url: true,
          events: true,
          is_active: true,
          created_at: true,
        },
      });
      return {
        ...created,
        // Return secret once at creation so caller can store it.
        secret,
      };
    });

    return NextResponse.json({ data: registration }, { status: 201 });
  },
  { permission: 'canAdmin', message: 'Webhook 登録権限がありません' },
);

// Re-export supported event types for reference
export type { WebhookEventType } from '@/server/services/outbound-webhook';
