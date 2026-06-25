import { withAuthContext } from '@/lib/auth/context';
import { parseBoundedInteger } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { compatibilityError, success, validationCompatibilityError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { z } from 'zod';
import {
  hasWebhookUrlCredentials,
  isAllowedWebhookUrl,
  redactWebhookUrlForDisplay,
  WEBHOOK_EVENT_TYPES,
} from '@/server/services/outbound-webhook';
import { encryptWebhookSecret } from '@/server/services/webhook-secret-encryption';
import { randomBytes } from 'node:crypto';

const createWebhookSchema = z.object({
  url: z.string().url('有効なURLを入力してください'),
  events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1, 'イベントを1件以上選択してください'),
});

const DEFAULT_WEBHOOK_REGISTRATION_LIMIT = 100;
const MAX_WEBHOOK_REGISTRATION_LIMIT = 200;

function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}

function toPublicWebhookRegistration<T extends { url: string }>(registration: T): T {
  return { ...registration, url: redactWebhookUrlForDisplay(registration.url) };
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const limit = parseBoundedInteger(
      searchParams.get('limit'),
      DEFAULT_WEBHOOK_REGISTRATION_LIMIT,
      1,
      MAX_WEBHOOK_REGISTRATION_LIMIT,
    );

    const registrations = await withOrgContext(ctx.orgId, async (tx) => {
      return tx.webhookRegistration.findMany({
        where: { org_id: ctx.orgId },
        orderBy: { created_at: 'desc' },
        take: limit,
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

    return success({ data: registrations.map(toPublicWebhookRegistration) });
  },
  { permission: 'canAdmin', message: 'Webhook 設定の閲覧権限がありません' },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) {
      return validationCompatibilityError('リクエストボディが不正です');
    }

    const parsed = createWebhookSchema.safeParse(payload);
    if (!parsed.success) {
      return validationCompatibilityError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { url, events } = parsed.data;

    if (hasWebhookUrlCredentials(url)) {
      return validationCompatibilityError('WebhookのURLにユーザー情報は含められません');
    }

    if (!(await isAllowedWebhookUrl(url))) {
      return validationCompatibilityError(
        'WebhookのURLはHTTPS公開エンドポイントである必要があります',
      );
    }

    const secret = generateWebhookSecret();
    let encryptedSecret;
    try {
      encryptedSecret = await encryptWebhookSecret(secret);
    } catch {
      return compatibilityError(
        'WEBHOOK_SECRET_ENCRYPTION_UNAVAILABLE',
        'Webhook secret 暗号化キーが設定されていません',
        503,
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
      await createAuditLogEntry(tx, ctx, {
        action: 'webhook_registration_created',
        targetType: 'WebhookRegistration',
        targetId: created.id,
        changes: {
          url: redactWebhookUrlForDisplay(url),
          events,
          secret_key_id: encryptedSecret.secret_key_id,
        },
      });
      return {
        ...toPublicWebhookRegistration(created),
        // Return secret once at creation so caller can store it.
        secret,
      };
    });

    return success({ data: registration }, 201);
  },
  { permission: 'canAdmin', message: 'Webhook 登録権限がありません' },
);

// Re-export supported event types for reference
export type { WebhookEventType } from '@/server/services/outbound-webhook';
